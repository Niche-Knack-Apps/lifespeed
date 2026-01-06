package com.nicheknack.atthespeedoflife;

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
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {
    private static final String TAG = "FolderPickerPlugin";

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Log.d(TAG, "pickDirectory called");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleDirectoryResult");
    }

    @ActivityCallback
    private void handleDirectoryResult(PluginCall call, ActivityResult result) {
        Log.d(TAG, "handleDirectoryResult called with resultCode: " + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            Log.d(TAG, "Selected URI: " + treeUri.toString());

            // Take persistent permission for both read and write
            final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            try {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                Log.d(TAG, "Persistent permission granted");
            } catch (SecurityException e) {
                Log.e(TAG, "Failed to take persistent permission: " + e.getMessage());
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("uri", treeUri.toString());

            // Get display name
            DocumentFile directory = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (directory != null) {
                ret.put("name", directory.getName());
            }

            call.resolve(ret);
        } else {
            Log.d(TAG, "Directory selection cancelled or failed");
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "User cancelled or selection failed");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void listEntries(PluginCall call) {
        String uriString = call.getString("uri");
        Log.d(TAG, "listEntries called with URI: " + uriString);

        if (uriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        try {
            Uri treeUri = Uri.parse(uriString);
            DocumentFile directory = DocumentFile.fromTreeUri(getContext(), treeUri);

            if (directory == null || !directory.exists()) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Directory not found or inaccessible");
                call.resolve(ret);
                return;
            }

            JSArray entries = new JSArray();
            DocumentFile[] files = directory.listFiles();

            for (DocumentFile file : files) {
                // Only include directories (entry bundles)
                if (file.isDirectory()) {
                    String name = file.getName();
                    if (name != null) {
                        // Check if it has an index.md file inside
                        DocumentFile indexFile = file.findFile("index.md");
                        if (indexFile != null && indexFile.exists()) {
                            JSObject entry = new JSObject();
                            entry.put("dirname", name);
                            entry.put("uri", file.getUri().toString());
                            entry.put("indexUri", indexFile.getUri().toString());
                            entry.put("mtime", indexFile.lastModified());

                            // Read frontmatter title from index.md
                            String title = extractTitleFromFrontmatter(indexFile);
                            if (title != null && !title.isEmpty()) {
                                entry.put("title", title);
                            }

                            entries.put(entry);
                        }
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("entries", entries);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Error listing entries: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri");
        Log.d(TAG, "readFile called with URI: " + uriString);

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
            Log.e(TAG, "Error reading file: " + e.getMessage());
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
        Log.d(TAG, "writeFile called with URI: " + uriString);

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
            Log.e(TAG, "Error writing file: " + e.getMessage());
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
        Log.d(TAG, "createEntry called - dirname: " + dirname);

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
            Log.e(TAG, "Error creating entry: " + e.getMessage());
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
        Log.d(TAG, "saveImage called - filename: " + filename);

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
            Log.e(TAG, "Error saving image: " + e.getMessage());
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
        Log.d(TAG, "saveFile called - filename: " + filename);

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
            Log.e(TAG, "Error saving file: " + e.getMessage());
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
        Log.d(TAG, "readImage called - path: " + relativePath);

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
            Log.e(TAG, "Error reading image: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        Log.d(TAG, "pickImage called");
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "handlePickImageResult");
    }

    @ActivityCallback
    private void handlePickImageResult(PluginCall call, ActivityResult result) {
        Log.d(TAG, "handlePickImageResult called with resultCode: " + result.getResultCode());

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
                Log.e(TAG, "Error reading picked image: " + e.getMessage());
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
        Log.d(TAG, "pickFile called");
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "handlePickFileResult");
    }

    @ActivityCallback
    private void handlePickFileResult(PluginCall call, ActivityResult result) {
        Log.d(TAG, "handlePickFileResult called with resultCode: " + result.getResultCode());

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
                Log.e(TAG, "Error reading picked file: " + e.getMessage());
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
        Log.d(TAG, "deleteEntry called with URI: " + entryUriString);

        if (entryUriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        try {
            Uri entryUri = Uri.parse(entryUriString);
            DocumentFile entryDir = DocumentFile.fromTreeUri(getContext(), entryUri);

            if (entryDir == null || !entryDir.exists()) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Entry directory not found");
                call.resolve(ret);
                return;
            }

            // Delete the directory and all contents
            boolean deleted = entryDir.delete();

            JSObject ret = new JSObject();
            ret.put("success", deleted);
            if (!deleted) {
                ret.put("error", "Failed to delete entry");
            }
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Error deleting entry: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * Fast entry listing - returns only directory info without reading file contents.
     * Used for cache comparison to detect new/modified/deleted entries.
     * Runs in background thread to avoid blocking UI.
     */
    @PluginMethod
    public void listEntriesFast(PluginCall call) {
        String uriString = call.getString("uri");
        Log.d(TAG, "listEntriesFast called with URI: " + uriString);

        if (uriString == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "No URI provided");
            call.resolve(ret);
            return;
        }

        // Run in background thread to avoid blocking UI
        new Thread(() -> {
            try {
                Uri treeUri = Uri.parse(uriString);
                DocumentFile directory = DocumentFile.fromTreeUri(getContext(), treeUri);

                if (directory == null || !directory.exists()) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Directory not found or inaccessible");
                    call.resolve(ret);
                    return;
                }

                JSArray entries = new JSArray();
                DocumentFile[] files = directory.listFiles();
                Log.d(TAG, "listEntriesFast: found " + files.length + " items");

                for (DocumentFile file : files) {
                    // Only include directories (entry bundles)
                    if (file.isDirectory()) {
                        String name = file.getName();
                        if (name != null) {
                            // Check if it has an index.md file (quick existence check, no read)
                            DocumentFile indexFile = file.findFile("index.md");
                            if (indexFile != null && indexFile.exists()) {
                                JSObject entry = new JSObject();
                                entry.put("dirname", name);
                                entry.put("uri", file.getUri().toString());
                                entry.put("indexUri", indexFile.getUri().toString());
                                entry.put("mtime", indexFile.lastModified());
                                // NO title extraction - that's done separately in batchGetMetadata
                                entries.put(entry);
                            }
                        }
                    }
                }

                Log.d(TAG, "listEntriesFast: returning " + entries.length() + " entries");
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", entries);
                ret.put("count", entries.length());
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Error in listEntriesFast: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    /**
     * Batch read metadata for multiple entries.
     * Extracts title, date, tags, and excerpt from frontmatter.
     * Runs in background thread to avoid blocking UI.
     */
    @PluginMethod
    public void batchGetMetadata(PluginCall call) {
        JSArray entriesArray = call.getArray("entries");
        Log.d(TAG, "batchGetMetadata called for " + (entriesArray != null ? entriesArray.length() : 0) + " entries");

        if (entriesArray == null || entriesArray.length() == 0) {
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("entries", new JSArray());
            call.resolve(ret);
            return;
        }

        // Capture array for use in thread
        final JSArray entries = entriesArray;

        // Run in background thread to avoid blocking UI
        new Thread(() -> {
            try {
                JSArray results = new JSArray();

                for (int i = 0; i < entries.length(); i++) {
                    try {
                        JSONObject entryInput = entries.getJSONObject(i);
                        String indexUri = entryInput.optString("indexUri", null);
                        String dirname = entryInput.optString("dirname", null);
                        String entryUri = entryInput.optString("uri", null);
                        long mtime = entryInput.optLong("mtime", 0);

                        if (indexUri == null) continue;

                        Uri fileUri = Uri.parse(indexUri);
                        DocumentFile indexFile = DocumentFile.fromSingleUri(getContext(), fileUri);

                        if (indexFile == null || !indexFile.exists()) continue;

                        // Extract metadata from frontmatter
                        JSObject metadata = extractMetadataFromFile(indexFile);
                        metadata.put("path", indexUri);
                        metadata.put("dirname", dirname);
                        metadata.put("entryUri", entryUri);
                        metadata.put("mtime", mtime);

                        results.put(metadata);
                    } catch (Exception e) {
                        Log.w(TAG, "Error processing entry at index " + i + ": " + e.getMessage());
                    }
                }

                Log.d(TAG, "batchGetMetadata: returning " + results.length() + " entries");
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("entries", results);
                ret.put("count", results.length());
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Error in batchGetMetadata: " + e.getMessage());
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        }).start();
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
            Log.e(TAG, "Error extracting metadata: " + e.getMessage());
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
            Log.e(TAG, "Error extracting title: " + e.getMessage());
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
