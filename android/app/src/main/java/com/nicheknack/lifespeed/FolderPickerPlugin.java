package com.nicheknack.lifespeed;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.database.Cursor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Callable;
import java.util.ArrayList;
import java.util.List;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {
    private static final String TAG = "FolderPickerPlugin";

    /**
     * Log to both Android Logcat AND JavaScript DebugLogger via Capacitor event.
     * This ensures native logs appear in the unified downloadable logs.
     */
    private void logToJS(String level, String message) {
        // Still log to Logcat for Android Studio debugging
        switch (level) {
            case "error":
                Log.e(TAG, message);
                break;
            case "warn":
                Log.w(TAG, message);
                break;
            default:
                Log.d(TAG, message);
                break;
        }

        // Send to JavaScript DebugLogger via Capacitor event
        JSObject logEvent = new JSObject();
        logEvent.put("level", level);
        logEvent.put("message", "[Native] " + message);
        logEvent.put("tag", TAG);
        logEvent.put("timestamp", System.currentTimeMillis());
        notifyListeners("nativeLog", logEvent);
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        logToJS("debug", "pickDirectory called");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        // Hint to start in Documents folder (API 26+)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            Uri initialUri = Uri.parse("content://com.android.externalstorage.documents/document/primary:Documents");
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
            logToJS("debug", "pickDirectory: set initial URI hint to Documents folder");
        }

        startActivityForResult(call, intent, "handleDirectoryResult");
    }

    @ActivityCallback
    private void handleDirectoryResult(PluginCall call, ActivityResult result) {
        logToJS("debug", "handleDirectoryResult called with resultCode: " + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            logToJS("debug", "Selected URI: " + treeUri.toString());

            // Take persistent permission for both read and write
            final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            try {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                logToJS("debug", "Persistent permission granted");
            } catch (SecurityException e) {
                logToJS("error", "Failed to take persistent permission: " + e.getMessage());
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("uri", treeUri.toString());

            // Extract display name from URI without SAF queries (instant).
            // DocumentFile.fromTreeUri + getName/exists/canRead each do slow
            // ContentResolver queries that add seconds on large directories.
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            String name = docId;
            if (docId != null) {
                int slash = docId.lastIndexOf('/');
                if (slash >= 0) name = docId.substring(slash + 1);
                int colon = name.lastIndexOf(':');
                if (colon >= 0) name = name.substring(colon + 1);
            }
            ret.put("name", name != null && !name.isEmpty() ? name : "Journal");
            logToJS("debug", "Directory added: " + treeUri + " (name: " + name + ")");

            call.resolve(ret);
        } else {
            logToJS("debug", "Directory selection cancelled or failed");
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "User cancelled or selection failed");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void listEntries(PluginCall call) {
        String uriString = call.getString("uri");
        logToJS("debug", "listEntries called with URI: " + uriString);

        if (uriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        // Run in background thread to prevent ANR
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.submit(() -> {
            try {
                Uri treeUri = Uri.parse(uriString);

                // Try fast DocumentsContract approach first
                logToJS("debug", "listEntries: trying DocumentsContract approach");
                JSArray entries = listEntriesUsingDocumentsContract(treeUri, true);

                // If that returns no results, fallback to DocumentFile (slower but more reliable)
                if (entries == null || entries.length() == 0) {
                    logToJS("warn", "listEntries: DocumentsContract returned no entries, trying DocumentFile fallback");
                    entries = listEntriesUsingDocumentFile(treeUri, true);
                }

                logToJS("debug", "listEntries: returning " + entries.length() + " entries");
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", entries);
                call.resolve(ret);

            } catch (Exception e) {
                logToJS("error", "Error listing entries: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        });

        // Don't block main thread - let background thread handle completion
        executor.shutdown();
    }

    /**
     * Fast directory listing using DocumentsContract cursor queries.
     * May fail on some devices/storage providers.
     * @param extractTitles Whether to extract titles from frontmatter (slower if true)
     */
    private JSArray listEntriesUsingDocumentsContract(Uri treeUri, boolean extractTitles) {
        JSArray entries = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();

        try {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri rootChildrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId);

            try (Cursor cursor = resolver.query(rootChildrenUri,
                    new String[]{
                        Document.COLUMN_DOCUMENT_ID,
                        Document.COLUMN_DISPLAY_NAME,
                        Document.COLUMN_MIME_TYPE,
                        Document.COLUMN_LAST_MODIFIED
                    },
                    null, null, null)) {

                if (cursor == null) {
                    logToJS("warn", "DocumentsContract: root cursor is null");
                    return entries;
                }

                logToJS("debug", "DocumentsContract: root cursor has " + cursor.getCount() + " items");

                while (cursor.moveToNext()) {
                    String docId = cursor.getString(0);
                    String name = cursor.getString(1);
                    String mimeType = cursor.getString(2);
                    long dirMtime = cursor.getLong(3);

                    if (!Document.MIME_TYPE_DIR.equals(mimeType)) continue;
                    if (name == null) continue;

                    Uri dirUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);

                    if (!extractTitles) {
                        // Fast path: construct index.md URI by convention (no inner cursor query).
                        // Valid for ExternalStorageProvider (standard local storage).
                        String indexDocId = docId + "/index.md";
                        Uri indexUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, indexDocId);

                        JSObject entry = new JSObject();
                        entry.put("dirname", name);
                        entry.put("uri", dirUri.toString());
                        entry.put("indexUri", indexUri.toString());
                        entry.put("mtime", dirMtime);
                        entries.put(entry);
                    } else {
                        // Full path: query inner cursor to find index.md and extract titles
                        Uri dirChildrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);

                        try (Cursor dirCursor = resolver.query(dirChildrenUri,
                                new String[]{
                                    Document.COLUMN_DOCUMENT_ID,
                                    Document.COLUMN_DISPLAY_NAME,
                                    Document.COLUMN_LAST_MODIFIED
                                },
                                null, null, null)) {

                            if (dirCursor != null) {
                                while (dirCursor.moveToNext()) {
                                    String childName = dirCursor.getString(1);
                                    if ("index.md".equals(childName)) {
                                        String indexDocId = dirCursor.getString(0);
                                        long mtime = dirCursor.getLong(2);

                                        Uri indexUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, indexDocId);

                                        JSObject entry = new JSObject();
                                        entry.put("dirname", name);
                                        entry.put("uri", dirUri.toString());
                                        entry.put("indexUri", indexUri.toString());
                                        entry.put("mtime", mtime);

                                        String title = extractTitleFromUri(indexUri);
                                        if (title != null && !title.isEmpty()) {
                                            entry.put("title", title);
                                        }

                                        entries.put(entry);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            logToJS("error", "DocumentsContract listing failed: " + e.getMessage());
        }

        return entries;
    }

    /**
     * Fallback directory listing using DocumentFile (slower but more reliable).
     * Works better across different Android versions and OEMs.
     * @param extractTitles Whether to extract titles from frontmatter (slower if true)
     */
    private JSArray listEntriesUsingDocumentFile(Uri treeUri, boolean extractTitles) {
        JSArray entries = new JSArray();

        try {
            DocumentFile directory = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (directory == null || !directory.exists() || !directory.isDirectory()) {
                logToJS("error", "DocumentFile: not a valid directory");
                return entries;
            }

            logToJS("debug", "DocumentFile: directory name = " + directory.getName());
            DocumentFile[] children = directory.listFiles();
            logToJS("debug", "DocumentFile: found " + (children != null ? children.length : 0) + " children");

            if (children == null) return entries;

            for (DocumentFile child : children) {
                if (!child.isDirectory()) continue;

                String name = child.getName();
                if (name == null) continue;

                // Look for index.md in this directory
                DocumentFile indexFile = child.findFile("index.md");
                if (indexFile != null && indexFile.exists()) {
                    JSObject entry = new JSObject();
                    entry.put("dirname", name);
                    entry.put("uri", child.getUri().toString());
                    entry.put("indexUri", indexFile.getUri().toString());
                    entry.put("mtime", indexFile.lastModified());

                    if (extractTitles) {
                        String title = extractTitleFromUri(indexFile.getUri());
                        if (title != null && !title.isEmpty()) {
                            entry.put("title", title);
                        }
                    }

                    entries.put(entry);
                }
            }
        } catch (Exception e) {
            logToJS("error", "DocumentFile listing failed: " + e.getMessage());
        }

        return entries;
    }

    /**
     * Fast title extraction using URI directly (no DocumentFile overhead)
     */
    private String extractTitleFromUri(Uri fileUri) {
        try {
            ContentResolver resolver = getContext().getContentResolver();
            try (InputStream inputStream = resolver.openInputStream(fileUri)) {
                if (inputStream == null) return null;

                BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
                String line;
                boolean inFrontmatter = false;
                int lineCount = 0;

                while ((line = reader.readLine()) != null && lineCount < 20) {
                    lineCount++;
                    line = line.trim();

                    if (line.equals("---")) {
                        if (!inFrontmatter) {
                            inFrontmatter = true;
                            continue;
                        } else {
                            break;
                        }
                    }

                    if (inFrontmatter && line.startsWith("title:")) {
                        String title = line.substring(6).trim();
                        if ((title.startsWith("\"") && title.endsWith("\"")) ||
                            (title.startsWith("'") && title.endsWith("'"))) {
                            title = title.substring(1, title.length() - 1);
                        }
                        return title;
                    }
                }
            }
        } catch (Exception e) {
            logToJS("error", "Error extracting title: " + e.getMessage());
        }
        return null;
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri");
        logToJS("debug", "readFile called with URI: " + uriString);

        if (uriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        try {
            Uri fileUri = Uri.parse(uriString);
            ContentResolver resolver = getContext().getContentResolver();
            InputStream inputStream = resolver.openInputStream(fileUri);

            if (inputStream == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not open file");
                call.resolve(ret);
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line).append("\n");
            }
            reader.close();
            inputStream.close();

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("content", content.toString());
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error reading file: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriString = call.getString("uri");
        String content = call.getString("content");
        logToJS("debug", "writeFile called with URI: " + uriString);

        if (uriString == null || content == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing URI or content");
            call.resolve(ret);
            return;
        }

        try {
            Uri fileUri = Uri.parse(uriString);
            ContentResolver resolver = getContext().getContentResolver();
            OutputStream outputStream = resolver.openOutputStream(fileUri, "wt");

            if (outputStream == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not open file for writing");
                call.resolve(ret);
                return;
            }

            outputStream.write(content.getBytes(StandardCharsets.UTF_8));
            outputStream.close();

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error writing file: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void createEntry(PluginCall call) {
        String baseUriString = call.getString("uri");
        String dirname = call.getString("dirname");
        String content = call.getString("content");
        logToJS("debug", "createEntry called - dirname: " + dirname);

        if (baseUriString == null || dirname == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing base URI or dirname");
            call.resolve(ret);
            return;
        }

        try {
            Uri treeUri = Uri.parse(baseUriString);
            DocumentFile baseDir = DocumentFile.fromTreeUri(getContext(), treeUri);

            if (baseDir == null || !baseDir.exists()) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Base directory not found");
                call.resolve(ret);
                return;
            }

            // Create entry directory
            DocumentFile entryDir = baseDir.createDirectory(dirname);
            if (entryDir == null) {
                // Directory might already exist
                entryDir = baseDir.findFile(dirname);
                if (entryDir == null || !entryDir.isDirectory()) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Could not create entry directory");
                    call.resolve(ret);
                    return;
                }
            }

            // Create index.md file
            DocumentFile indexFile = entryDir.findFile("index.md");
            if (indexFile == null) {
                indexFile = entryDir.createFile("text/markdown", "index.md");
            }

            if (indexFile == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not create index.md");
                call.resolve(ret);
                return;
            }

            // Write content if provided
            if (content != null) {
                ContentResolver resolver = getContext().getContentResolver();
                OutputStream outputStream = resolver.openOutputStream(indexFile.getUri(), "wt");
                if (outputStream != null) {
                    outputStream.write(content.getBytes(StandardCharsets.UTF_8));
                    outputStream.close();
                }
            }

            // Create images subdirectory
            DocumentFile imagesDir = entryDir.findFile("images");
            if (imagesDir == null) {
                entryDir.createDirectory("images");
            }

            // Create files subdirectory
            DocumentFile filesDir = entryDir.findFile("files");
            if (filesDir == null) {
                entryDir.createDirectory("files");
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("dirname", dirname);
            ret.put("uri", entryDir.getUri().toString());
            ret.put("indexUri", indexFile.getUri().toString());
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error creating entry: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String entryUriString = call.getString("entryUri");
        String base64Data = call.getString("base64Data");
        String filename = call.getString("filename");
        logToJS("debug", "saveImage called - filename: " + filename);

        if (entryUriString == null || base64Data == null || filename == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing parameters");
            call.resolve(ret);
            return;
        }

        try {
            Uri entryUri = Uri.parse(entryUriString);
            DocumentFile entryDir = DocumentFile.fromTreeUri(getContext(), entryUri);

            if (entryDir == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Entry directory not found");
                call.resolve(ret);
                return;
            }

            // Find or create images directory
            DocumentFile imagesDir = entryDir.findFile("images");
            if (imagesDir == null) {
                imagesDir = entryDir.createDirectory("images");
            }

            if (imagesDir == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not create images directory");
                call.resolve(ret);
                return;
            }

            // Determine mime type
            String mimeType = "image/png";
            if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
                mimeType = "image/jpeg";
            } else if (filename.endsWith(".webp")) {
                mimeType = "image/webp";
            } else if (filename.endsWith(".gif")) {
                mimeType = "image/gif";
            }

            // Create image file
            DocumentFile imageFile = imagesDir.findFile(filename);
            if (imageFile == null) {
                imageFile = imagesDir.createFile(mimeType, filename);
            }

            if (imageFile == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not create image file");
                call.resolve(ret);
                return;
            }

            // Decode base64 and write
            String base64 = base64Data;
            if (base64.contains(",")) {
                base64 = base64.substring(base64.indexOf(",") + 1);
            }
            byte[] imageBytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);

            ContentResolver resolver = getContext().getContentResolver();
            OutputStream outputStream = resolver.openOutputStream(imageFile.getUri(), "wt");
            if (outputStream != null) {
                outputStream.write(imageBytes);
                outputStream.close();
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("filename", filename);
            ret.put("relativePath", "images/" + filename);
            ret.put("markdown", "![](images/" + filename + ")");
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error saving image: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String entryUriString = call.getString("entryUri");
        String base64Data = call.getString("base64Data");
        String filename = call.getString("filename");
        logToJS("debug", "saveFile called - filename: " + filename);

        if (entryUriString == null || base64Data == null || filename == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing parameters");
            call.resolve(ret);
            return;
        }

        try {
            Uri entryUri = Uri.parse(entryUriString);
            DocumentFile entryDir = DocumentFile.fromTreeUri(getContext(), entryUri);

            if (entryDir == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Entry directory not found");
                call.resolve(ret);
                return;
            }

            // Find or create files directory
            DocumentFile filesDir = entryDir.findFile("files");
            if (filesDir == null) {
                filesDir = entryDir.createDirectory("files");
            }

            if (filesDir == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not create files directory");
                call.resolve(ret);
                return;
            }

            // Determine mime type from filename extension
            String mimeType = "application/octet-stream";
            String lowerName = filename.toLowerCase();
            if (lowerName.endsWith(".pdf")) {
                mimeType = "application/pdf";
            } else if (lowerName.endsWith(".txt")) {
                mimeType = "text/plain";
            } else if (lowerName.endsWith(".json")) {
                mimeType = "application/json";
            } else if (lowerName.endsWith(".xml")) {
                mimeType = "application/xml";
            } else if (lowerName.endsWith(".zip")) {
                mimeType = "application/zip";
            } else if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) {
                mimeType = "application/msword";
            } else if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) {
                mimeType = "application/vnd.ms-excel";
            }

            // Create file
            DocumentFile newFile = filesDir.findFile(filename);
            if (newFile == null) {
                newFile = filesDir.createFile(mimeType, filename);
            }

            if (newFile == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not create file");
                call.resolve(ret);
                return;
            }

            // Decode base64 and write
            String base64 = base64Data;
            if (base64.contains(",")) {
                base64 = base64.substring(base64.indexOf(",") + 1);
            }
            byte[] fileBytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);

            ContentResolver resolver = getContext().getContentResolver();
            OutputStream outputStream = resolver.openOutputStream(newFile.getUri(), "wt");
            if (outputStream != null) {
                outputStream.write(fileBytes);
                outputStream.close();
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("filename", filename);
            ret.put("relativePath", "files/" + filename);
            ret.put("markdown", "[" + filename + "](files/" + filename + ")");
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error saving file: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void readImage(PluginCall call) {
        String entryUriString = call.getString("entryUri");
        String relativePath = call.getString("relativePath");
        logToJS("debug", "readImage called - path: " + relativePath);

        if (entryUriString == null || relativePath == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing parameters");
            call.resolve(ret);
            return;
        }

        try {
            Uri entryUri = Uri.parse(entryUriString);
            DocumentFile entryDir = DocumentFile.fromTreeUri(getContext(), entryUri);

            if (entryDir == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Entry directory not found");
                call.resolve(ret);
                return;
            }

            // Parse relative path (e.g., "images/2025-01-01.png")
            String[] parts = relativePath.split("/");
            DocumentFile targetFile = entryDir;

            for (String part : parts) {
                if (part.isEmpty()) continue;
                targetFile = targetFile.findFile(part);
                if (targetFile == null) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "File not found: " + part);
                    call.resolve(ret);
                    return;
                }
            }

            // Read file as base64
            ContentResolver resolver = getContext().getContentResolver();
            InputStream inputStream = resolver.openInputStream(targetFile.getUri());

            if (inputStream == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Could not open file");
                call.resolve(ret);
                return;
            }

            // Read all bytes
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] data = new byte[8192];
            int bytesRead;
            while ((bytesRead = inputStream.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, bytesRead);
            }
            inputStream.close();

            byte[] fileBytes = buffer.toByteArray();
            String base64 = android.util.Base64.encodeToString(fileBytes, android.util.Base64.NO_WRAP);

            // Determine mime type
            String mimeType = "image/png";
            String lowerPath = relativePath.toLowerCase();
            if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
                mimeType = "image/jpeg";
            } else if (lowerPath.endsWith(".webp")) {
                mimeType = "image/webp";
            } else if (lowerPath.endsWith(".gif")) {
                mimeType = "image/gif";
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("dataUrl", "data:" + mimeType + ";base64," + base64);
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error reading image: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        logToJS("debug", "pickImage called");
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "handlePickImageResult");
    }

    @ActivityCallback
    private void handlePickImageResult(PluginCall call, ActivityResult result) {
        logToJS("debug", "handlePickImageResult called with resultCode: " + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "No file selected");
                call.resolve(ret);
                return;
            }

            try {
                // Get filename
                String filename = getFileName(uri);
                if (filename == null) {
                    filename = "image_" + System.currentTimeMillis() + ".png";
                }

                // Read file as base64
                ContentResolver resolver = getContext().getContentResolver();
                InputStream inputStream = resolver.openInputStream(uri);
                if (inputStream == null) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Could not open file");
                    call.resolve(ret);
                    return;
                }

                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] data = new byte[8192];
                int bytesRead;
                while ((bytesRead = inputStream.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, bytesRead);
                }
                inputStream.close();

                byte[] fileBytes = buffer.toByteArray();
                String base64 = android.util.Base64.encodeToString(fileBytes, android.util.Base64.NO_WRAP);

                // Determine mime type
                String mimeType = resolver.getType(uri);
                if (mimeType == null) {
                    mimeType = "image/png";
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("filename", filename);
                ret.put("mimeType", mimeType);
                ret.put("base64Data", "data:" + mimeType + ";base64," + base64);
                call.resolve(ret);

            } catch (Exception e) {
                logToJS("error", "Error reading picked image: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("canceled", true);
            ret.put("error", "User cancelled");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        logToJS("debug", "pickFile called");
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "handlePickFileResult");
    }

    @ActivityCallback
    private void handlePickFileResult(PluginCall call, ActivityResult result) {
        logToJS("debug", "handlePickFileResult called with resultCode: " + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri == null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "No file selected");
                call.resolve(ret);
                return;
            }

            try {
                // Get filename
                String filename = getFileName(uri);
                if (filename == null) {
                    filename = "file_" + System.currentTimeMillis();
                }

                // Read file as base64
                ContentResolver resolver = getContext().getContentResolver();
                InputStream inputStream = resolver.openInputStream(uri);
                if (inputStream == null) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Could not open file");
                    call.resolve(ret);
                    return;
                }

                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] data = new byte[8192];
                int bytesRead;
                while ((bytesRead = inputStream.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, bytesRead);
                }
                inputStream.close();

                byte[] fileBytes = buffer.toByteArray();
                String base64 = android.util.Base64.encodeToString(fileBytes, android.util.Base64.NO_WRAP);

                // Get mime type
                String mimeType = resolver.getType(uri);
                if (mimeType == null) {
                    mimeType = "application/octet-stream";
                }

                // Check if it's an image
                boolean isImage = mimeType.startsWith("image/");

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("filename", filename);
                ret.put("mimeType", mimeType);
                ret.put("isImage", isImage);
                ret.put("base64Data", "data:" + mimeType + ";base64," + base64);
                call.resolve(ret);

            } catch (Exception e) {
                logToJS("error", "Error reading picked file: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("canceled", true);
            ret.put("error", "User cancelled");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void deleteEntry(PluginCall call) {
        String entryUriString = call.getString("entryUri");
        logToJS("debug", "deleteEntry called with URI: " + entryUriString);

        if (entryUriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        try {
            Uri entryUri = Uri.parse(entryUriString);

            // Use DocumentsContract.deleteDocument for proper SAF deletion
            // This works for both tree URIs and document URIs from tree iteration
            boolean deleted = DocumentsContract.deleteDocument(
                getContext().getContentResolver(),
                entryUri
            );

            logToJS("debug", "deleteEntry result: " + deleted);

            JSObject ret = new JSObject();
            ret.put("success", deleted);
            if (!deleted) {
                ret.put("error", "Failed to delete entry");
            }
            call.resolve(ret);

        } catch (Exception e) {
            String errorMsg = e.getMessage();
            // Check if error is because file doesn't exist - treat as successful deletion
            boolean fileNotFound = errorMsg != null && (
                errorMsg.contains("FileNotFoundException") ||
                errorMsg.contains("Missing file") ||
                errorMsg.contains("No such file") ||
                errorMsg.contains("does not exist") ||
                e instanceof java.io.FileNotFoundException
            );

            if (fileNotFound) {
                logToJS("debug", "deleteEntry: file not found, treating as success: " + errorMsg);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("alreadyDeleted", true);
                call.resolve(ret);
            } else {
                logToJS("error", "Error deleting entry: " + errorMsg);
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", errorMsg);
                call.resolve(ret);
            }
        }
    }

    /**
     * Fast entry listing - returns only directory info without reading file contents.
     * Used for cache comparison to detect new/modified/deleted entries.
     * Uses hybrid approach: tries DocumentsContract first, falls back to DocumentFile.
     */
    @PluginMethod
    public void listEntriesFast(PluginCall call) {
        String uriString = call.getString("uri");
        logToJS("debug", "listEntriesFast called with URI: " + uriString);

        if (uriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        // Run in background thread
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.submit(() -> {
            try {
                Uri treeUri = Uri.parse(uriString);

                // Try fast DocumentsContract approach first (no title extraction)
                logToJS("debug", "listEntriesFast: trying DocumentsContract approach");
                JSArray entries = listEntriesUsingDocumentsContract(treeUri, false);

                // If that returns no results, fallback to DocumentFile
                if (entries == null || entries.length() == 0) {
                    logToJS("warn", "listEntriesFast: DocumentsContract returned no entries, trying DocumentFile fallback");
                    entries = listEntriesUsingDocumentFile(treeUri, false);
                }

                logToJS("debug", "listEntriesFast: returning " + entries.length() + " entries");
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", entries);
                ret.put("count", entries.length());
                call.resolve(ret);

            } catch (Exception e) {
                logToJS("error", "Error in listEntriesFast: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        });

        // Don't block main thread - let background thread handle completion
        executor.shutdown();
    }

    // ===== Internal Storage Methods (non-SAF, for default journal) =====

    @PluginMethod
    public void getInternalJournalPath(PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "journal");
        if (!dir.exists()) dir.mkdirs();
        JSObject ret = new JSObject();
        ret.put("path", dir.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void createEntryInternal(PluginCall call) {
        String path = call.getString("path");
        String dirname = call.getString("dirname");
        String content = call.getString("content");
        logToJS("debug", "createEntryInternal called - path: " + path + ", dirname: " + dirname);

        if (path == null || dirname == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing path or dirname");
            call.resolve(ret);
            return;
        }

        try {
            File entryDir = new File(path, dirname);
            if (!entryDir.exists()) entryDir.mkdirs();

            File indexFile = new File(entryDir, "index.md");
            if (content != null) {
                FileWriter writer = new FileWriter(indexFile);
                writer.write(content);
                writer.close();
            }

            // Create images and files subdirectories
            new File(entryDir, "images").mkdirs();
            new File(entryDir, "files").mkdirs();

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("path", indexFile.getAbsolutePath());
            ret.put("dirname", dirname);
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error creating internal entry: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void writeFileInternal(PluginCall call) {
        String path = call.getString("path");
        String content = call.getString("content");
        logToJS("debug", "writeFileInternal called - path: " + path);

        if (path == null || content == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "Missing path or content");
            call.resolve(ret);
            return;
        }

        try {
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();

            FileWriter writer = new FileWriter(file);
            writer.write(content);
            writer.close();

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error writing internal file: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void readFileInternal(PluginCall call) {
        String path = call.getString("path");
        logToJS("debug", "readFileInternal called - path: " + path);

        if (path == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No path provided");
            call.resolve(ret);
            return;
        }

        try {
            File file = new File(path);
            if (!file.exists()) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "File not found");
                call.resolve(ret);
                return;
            }

            BufferedReader reader = new BufferedReader(new FileReader(file));
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line).append("\n");
            }
            reader.close();

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("content", content.toString());
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error reading internal file: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void listEntriesInternal(PluginCall call) {
        String path = call.getString("path");
        logToJS("debug", "listEntriesInternal called - path: " + path);

        if (path == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No path provided");
            call.resolve(ret);
            return;
        }

        try {
            File dir = new File(path);
            if (!dir.exists() || !dir.isDirectory()) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", new JSArray());
                call.resolve(ret);
                return;
            }

            File[] children = dir.listFiles();
            JSArray entries = new JSArray();

            if (children != null) {
                for (File child : children) {
                    if (!child.isDirectory()) continue;

                    File indexFile = new File(child, "index.md");
                    if (!indexFile.exists()) continue;

                    JSObject entry = new JSObject();
                    entry.put("dirname", child.getName());
                    entry.put("path", indexFile.getAbsolutePath());
                    entry.put("mtime", indexFile.lastModified());

                    JSObject metadata = extractMetadataFromInternalFile(indexFile);
                    if (metadata != null) {
                        entry.put("title", metadata.optString("title", ""));
                        entry.put("date", metadata.optString("date", ""));
                        entry.put("tags", metadata.opt("tags") != null ? metadata.opt("tags") : new JSArray());
                        entry.put("excerpt", metadata.optString("excerpt", ""));
                    }

                    entries.put(entry);
                }
            }

            logToJS("debug", "listEntriesInternal: returning " + entries.length() + " entries");
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("entries", entries);
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error listing internal entries: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void deleteDirectoryInternal(PluginCall call) {
        String path = call.getString("path");
        logToJS("debug", "deleteDirectoryInternal called - path: " + path);

        if (path == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No path provided");
            call.resolve(ret);
            return;
        }

        try {
            File dir = new File(path);
            boolean deleted = deleteRecursive(dir);

            JSObject ret = new JSObject();
            ret.put("success", deleted);
            if (!deleted) {
                ret.put("error", "Failed to delete directory");
            }
            call.resolve(ret);

        } catch (Exception e) {
            logToJS("error", "Error deleting internal directory: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    private boolean deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        return file.delete();
    }

    private JSObject extractMetadataFromInternalFile(File file) {
        JSObject metadata = new JSObject();

        try {
            BufferedReader reader = new BufferedReader(new FileReader(file));
            StringBuilder contentBuilder = new StringBuilder();
            String line;
            boolean inFrontmatter = false;
            boolean frontmatterDone = false;
            int lineCount = 0;
            int contentLines = 0;

            String title = null;
            String date = null;
            JSArray tags = new JSArray();

            while ((line = reader.readLine()) != null && lineCount < 50) {
                lineCount++;

                if (line.trim().equals("---")) {
                    if (!inFrontmatter && lineCount <= 2) {
                        inFrontmatter = true;
                        continue;
                    } else if (inFrontmatter) {
                        inFrontmatter = false;
                        frontmatterDone = true;
                        continue;
                    }
                }

                if (inFrontmatter) {
                    if (line.startsWith("title:")) {
                        title = line.substring(6).trim();
                        if ((title.startsWith("\"") && title.endsWith("\"")) ||
                            (title.startsWith("'") && title.endsWith("'"))) {
                            title = title.substring(1, title.length() - 1);
                        }
                    } else if (line.startsWith("date:")) {
                        date = line.substring(5).trim();
                    } else if (line.startsWith("tags:")) {
                        String tagsStr = line.substring(5).trim();
                        if (tagsStr.startsWith("[") && tagsStr.endsWith("]")) {
                            tagsStr = tagsStr.substring(1, tagsStr.length() - 1);
                            for (String tag : tagsStr.split(",")) {
                                tag = tag.trim();
                                if (!tag.isEmpty()) {
                                    tags.put(tag);
                                }
                            }
                        }
                    }
                } else if (frontmatterDone && contentLines < 5) {
                    String trimmed = line.trim();
                    if (!trimmed.isEmpty()) {
                        if (contentBuilder.length() > 0) {
                            contentBuilder.append(" ");
                        }
                        contentBuilder.append(trimmed);
                        contentLines++;
                    }
                }
            }

            reader.close();

            metadata.put("title", title != null ? title : "");
            metadata.put("date", date != null ? date : "");
            metadata.put("tags", tags);

            String excerpt = contentBuilder.toString();
            if (excerpt.length() > 300) {
                excerpt = excerpt.substring(0, 300);
            }
            metadata.put("excerpt", excerpt);

        } catch (Exception e) {
            logToJS("error", "Error extracting metadata from internal file: " + e.getMessage());
            return null;
        }

        return metadata;
    }

    /**
     * Batch read metadata for multiple entries.
     * Extracts title, date, tags, and excerpt from frontmatter.
     * Uses parallel processing with thread pool for 4x speedup.
     */
    @PluginMethod
    public void batchGetMetadata(PluginCall call) {
        JSArray entriesArray = call.getArray("entries");
        logToJS("debug", "batchGetMetadata called for " + (entriesArray != null ? entriesArray.length() : 0) + " entries");

        if (entriesArray == null || entriesArray.length() == 0) {
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("entries", new JSArray());
            call.resolve(ret);
            return;
        }

        final JSArray entries = entriesArray;
        final int THREAD_COUNT = 16;

        // Run in background with parallel processing
        new Thread(() -> {
            try {
                ExecutorService executor = Executors.newFixedThreadPool(THREAD_COUNT);
                List<Future<JSObject>> futures = new ArrayList<>();

                for (int i = 0; i < entries.length(); i++) {
                    final int index = i;
                    futures.add(executor.submit(() -> {
                        try {
                            JSONObject entryInput = entries.getJSONObject(index);
                            String indexUri = entryInput.optString("indexUri", null);
                            String dirname = entryInput.optString("dirname", null);
                            String entryUri = entryInput.optString("uri", null);
                            long mtime = entryInput.optLong("mtime", 0);

                            if (indexUri == null) return null;

                            Uri fileUri = Uri.parse(indexUri);

                            // Extract metadata using URI directly (faster than DocumentFile)
                            JSObject metadata = extractMetadataFromUri(fileUri);
                            if (metadata == null) return null;
                            metadata.put("path", indexUri);
                            metadata.put("dirname", dirname);
                            metadata.put("entryUri", entryUri);
                            metadata.put("mtime", mtime);

                            return metadata;
                        } catch (Exception e) {
                            logToJS("warn", "Error processing entry at index " + index + ": " + e.getMessage());
                            return null;
                        }
                    }));
                }

                executor.shutdown();
                executor.awaitTermination(60, TimeUnit.SECONDS);

                // Collect results
                JSArray results = new JSArray();
                for (Future<JSObject> future : futures) {
                    try {
                        JSObject result = future.get();
                        if (result != null) {
                            results.put(result);
                        }
                    } catch (Exception e) {
                        // Skip failed entries
                    }
                }

                logToJS("debug", "batchGetMetadata: returning " + results.length() + " entries (parallel processing)");
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", results);
                ret.put("count", results.length());
                call.resolve(ret);

            } catch (Exception e) {
                logToJS("error", "Error in batchGetMetadata: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    /**
     * Extract metadata from URI directly (faster than DocumentFile)
     */
    private JSObject extractMetadataFromUri(Uri fileUri) {
        JSObject metadata = new JSObject();

        try {
            ContentResolver resolver = getContext().getContentResolver();
            try (InputStream inputStream = resolver.openInputStream(fileUri)) {
                if (inputStream == null) return metadata;

                BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
                StringBuilder contentBuilder = new StringBuilder();
                String line;
                boolean inFrontmatter = false;
                boolean frontmatterDone = false;
                int lineCount = 0;
                int contentLines = 0;

                String title = null;
                String date = null;
                JSArray tags = new JSArray();

                while ((line = reader.readLine()) != null && lineCount < 50) {
                    lineCount++;

                    if (line.trim().equals("---")) {
                        if (!inFrontmatter && lineCount <= 2) {
                            inFrontmatter = true;
                            continue;
                        } else if (inFrontmatter) {
                            inFrontmatter = false;
                            frontmatterDone = true;
                            continue;
                        }
                    }

                    if (inFrontmatter) {
                        if (line.startsWith("title:")) {
                            title = line.substring(6).trim();
                            if ((title.startsWith("\"") && title.endsWith("\"")) ||
                                (title.startsWith("'") && title.endsWith("'"))) {
                                title = title.substring(1, title.length() - 1);
                            }
                        } else if (line.startsWith("date:")) {
                            date = line.substring(5).trim();
                        } else if (line.startsWith("tags:")) {
                            String tagsStr = line.substring(5).trim();
                            if (tagsStr.startsWith("[") && tagsStr.endsWith("]")) {
                                tagsStr = tagsStr.substring(1, tagsStr.length() - 1);
                                for (String tag : tagsStr.split(",")) {
                                    tag = tag.trim();
                                    if (!tag.isEmpty()) {
                                        tags.put(tag);
                                    }
                                }
                            }
                        }
                    } else if (frontmatterDone && contentLines < 5) {
                        String trimmed = line.trim();
                        if (!trimmed.isEmpty()) {
                            if (contentBuilder.length() > 0) {
                                contentBuilder.append(" ");
                            }
                            contentBuilder.append(trimmed);
                            contentLines++;
                        }
                    }
                }

                metadata.put("title", title != null ? title : "");
                metadata.put("date", date != null ? date : "");
                metadata.put("tags", tags);

                String excerpt = contentBuilder.toString();
                if (excerpt.length() > 300) {
                    excerpt = excerpt.substring(0, 300);
                }
                metadata.put("excerpt", excerpt);
            }
        } catch (Exception e) {
            logToJS("error", "Error extracting metadata: " + e.getMessage());
            return null;
        }

        return metadata;
    }

    /**
     * Extract metadata (title, date, tags, excerpt) from a markdown file's frontmatter
     */
    private JSObject extractMetadataFromFile(DocumentFile file) {
        JSObject metadata = new JSObject();

        try {
            ContentResolver resolver = getContext().getContentResolver();
            InputStream inputStream = resolver.openInputStream(file.getUri());
            if (inputStream == null) return metadata;

            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
            StringBuilder contentBuilder = new StringBuilder();
            String line;
            boolean inFrontmatter = false;
            boolean frontmatterDone = false;
            int lineCount = 0;
            int contentLines = 0;

            String title = null;
            String date = null;
            JSArray tags = new JSArray();

            while ((line = reader.readLine()) != null && lineCount < 50) {
                lineCount++;

                if (line.trim().equals("---")) {
                    if (!inFrontmatter && lineCount <= 2) {
                        inFrontmatter = true;
                        continue;
                    } else if (inFrontmatter) {
                        inFrontmatter = false;
                        frontmatterDone = true;
                        continue;
                    }
                }

                if (inFrontmatter) {
                    // Parse frontmatter
                    if (line.startsWith("title:")) {
                        title = line.substring(6).trim();
                        // Remove quotes if present
                        if ((title.startsWith("\"") && title.endsWith("\"")) ||
                            (title.startsWith("'") && title.endsWith("'"))) {
                            title = title.substring(1, title.length() - 1);
                        }
                    } else if (line.startsWith("date:")) {
                        date = line.substring(5).trim();
                    } else if (line.startsWith("tags:")) {
                        String tagsStr = line.substring(5).trim();
                        // Parse inline array format: [tag1, tag2]
                        if (tagsStr.startsWith("[") && tagsStr.endsWith("]")) {
                            tagsStr = tagsStr.substring(1, tagsStr.length() - 1);
                            for (String tag : tagsStr.split(",")) {
                                tag = tag.trim();
                                if (!tag.isEmpty()) {
                                    tags.put(tag);
                                }
                            }
                        }
                    }
                } else if (frontmatterDone && contentLines < 5) {
                    // Collect first few lines of content for excerpt
                    String trimmed = line.trim();
                    if (!trimmed.isEmpty()) {
                        if (contentBuilder.length() > 0) {
                            contentBuilder.append(" ");
                        }
                        contentBuilder.append(trimmed);
                        contentLines++;
                    }
                }
            }

            reader.close();
            inputStream.close();

            metadata.put("title", title != null ? title : "");
            metadata.put("date", date != null ? date : "");
            metadata.put("tags", tags);

            // Create excerpt from first ~300 chars of content
            String excerpt = contentBuilder.toString();
            if (excerpt.length() > 300) {
                excerpt = excerpt.substring(0, 300);
            }
            metadata.put("excerpt", excerpt);

        } catch (Exception e) {
            logToJS("error", "Error extracting metadata: " + e.getMessage());
        }

        return metadata;
    }

    private String extractTitleFromFrontmatter(DocumentFile file) {
        try {
            ContentResolver resolver = getContext().getContentResolver();
            InputStream inputStream = resolver.openInputStream(file.getUri());
            if (inputStream == null) return null;

            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
            String line;
            boolean inFrontmatter = false;
            int lineCount = 0;

            while ((line = reader.readLine()) != null && lineCount < 20) {
                lineCount++;
                line = line.trim();

                if (line.equals("---")) {
                    if (!inFrontmatter) {
                        inFrontmatter = true;
                        continue;
                    } else {
                        // End of frontmatter, no title found
                        break;
                    }
                }

                if (inFrontmatter && line.startsWith("title:")) {
                    reader.close();
                    inputStream.close();
                    // Extract title value, removing quotes if present
                    String title = line.substring(6).trim();
                    if ((title.startsWith("\"") && title.endsWith("\"")) ||
                        (title.startsWith("'") && title.endsWith("'"))) {
                        title = title.substring(1, title.length() - 1);
                    }
                    return title;
                }
            }

            reader.close();
            inputStream.close();
        } catch (Exception e) {
            logToJS("error", "Error extracting title: " + e.getMessage());
        }
        return null;
    }

    private String getFileName(Uri uri) {
        String filename = null;
        if (uri.getScheme().equals("content")) {
            Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            try {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        filename = cursor.getString(nameIndex);
                    }
                }
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        }
        if (filename == null) {
            filename = uri.getLastPathSegment();
        }
        return filename;
    }
}
