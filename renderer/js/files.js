/**
 * File Attachments for Lifespeed
 * Non-image file attachment support
 */

const files = {
    async attach(filePath, entryPath) {
        // File attachments handled via platform.attachFile()
        return await platform.attachFile(filePath, entryPath);
    }
};
