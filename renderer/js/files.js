/**
 * File Attachments for At the Speed of Life
 * Non-image file attachment support
 */

const files = {
    async attach(filePath, entryPath) {
        if (platform.isElectron()) {
            return await window.api.attachFile(filePath, entryPath);
        }
        // Web fallback - not fully supported
        return { success: false, error: 'File attachments not supported in web mode' };
    }
};
