/**
 * scroll-sync.js
 *
 * Endemic scroll synchronization using anchor-based mapping with data-source-line attributes.
 * Provides accurate scroll sync between source editor (textarea) and preview (rendered HTML).
 */

(function() {
    'use strict';

    /**
     * ScrollSyncController manages bidirectional scroll synchronization
     * between source and preview panes using line-based anchors.
     */
    class ScrollSyncController {
        /**
         * @param {HTMLTextAreaElement} editor - Source editor textarea
         * @param {HTMLElement} preview - Preview container element
         */
        constructor(editor, preview) {
            this.editor = editor;
            this.preview = preview;
            this.scrollMap = null;
            this.scrollMaster = null; // 'source' | 'preview' | null
            this.isLocked = false;
            this.rebuildTimer = null;
            this.scrollTimer = null;
            this.resizeObserver = null;
            this._cachedLineHeight = null;
        }

        /**
         * Initialize scroll sync controller.
         * Sets up event listeners for scroll tracking and layout changes.
         */
        init() {
            // Track which pane user is interacting with
            this.editor.addEventListener('mouseenter', () => { this.scrollMaster = 'source'; });
            this.editor.addEventListener('touchstart', () => { this.scrollMaster = 'source'; }, { passive: true });
            this.editor.addEventListener('focus', () => { this.scrollMaster = 'source'; });

            this.preview.addEventListener('mouseenter', () => { this.scrollMaster = 'preview'; });
            this.preview.addEventListener('touchstart', () => { this.scrollMaster = 'preview'; }, { passive: true });
            this.preview.addEventListener('focus', () => { this.scrollMaster = 'preview'; });

            // Scroll listeners with RAF throttling
            this.editor.addEventListener('scroll', () => this.onSourceScroll(), { passive: true });
            this.preview.addEventListener('scroll', () => this.onPreviewScroll(), { passive: true });

            // Watch for layout changes
            this.setupLayoutObservers();
        }

        /**
         * Setup observers for layout changes (resize, images).
         */
        setupLayoutObservers() {
            // Resize observer for preview container
            if (typeof ResizeObserver !== 'undefined') {
                this.resizeObserver = new ResizeObserver(() => {
                    this.scheduleRebuild();
                });
                this.resizeObserver.observe(this.preview);
            }

            // Font load watcher
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => {
                    this._cachedLineHeight = null; // Invalidate cache
                    this.scheduleRebuild();
                });
            }
        }

        /**
         * Watch for image loads in preview and rebuild scroll map when complete.
         */
        watchImages() {
            const images = this.preview.querySelectorAll('img');
            let pending = 0;

            images.forEach(img => {
                if (!img.complete) {
                    pending++;
                    const onLoad = () => {
                        pending--;
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onLoad);
                        if (pending === 0) {
                            this.scheduleRebuild();
                        }
                    };
                    img.addEventListener('load', onLoad, { once: true });
                    img.addEventListener('error', onLoad, { once: true });
                }
            });
        }

        /**
         * Build the scroll map from data-source-line elements.
         * Maps source line numbers to preview pixel positions.
         */
        buildScrollMap() {
            const anchors = [];
            const elements = this.preview.querySelectorAll('[data-source-line]');

            if (elements.length === 0) {
                this.scrollMap = null;
                return;
            }

            const containerRect = this.preview.getBoundingClientRect();
            const scrollTop = this.preview.scrollTop;

            elements.forEach(el => {
                const line = parseInt(el.dataset.sourceLine, 10);
                if (isNaN(line)) return;

                const rect = el.getBoundingClientRect();
                anchors.push({
                    sourceLine: line,
                    previewTop: rect.top - containerRect.top + scrollTop,
                    previewHeight: rect.height
                });
            });

            // Sort by source line (should already be in order, but ensure)
            anchors.sort((a, b) => a.sourceLine - b.sourceLine);

            this.scrollMap = {
                anchors,
                sourceLineCount: this.editor.value.split('\n').length,
                previewScrollHeight: this.preview.scrollHeight,
                timestamp: Date.now()
            };
        }

        /**
         * Schedule a scroll map rebuild (debounced).
         */
        scheduleRebuild() {
            clearTimeout(this.rebuildTimer);
            this.rebuildTimer = setTimeout(() => this.buildScrollMap(), 100);
        }

        /**
         * Handle source editor scroll event.
         */
        onSourceScroll() {
            if (this.isLocked || this.scrollMaster !== 'source') return;

            clearTimeout(this.scrollTimer);
            this.scrollTimer = setTimeout(() => {
                this.syncPreviewToSource();
            }, 16); // ~60fps
        }

        /**
         * Handle preview scroll event.
         */
        onPreviewScroll() {
            if (this.isLocked || this.scrollMaster !== 'preview') return;

            clearTimeout(this.scrollTimer);
            this.scrollTimer = setTimeout(() => {
                this.syncSourceToPreview();
            }, 16);
        }

        /**
         * Sync preview scroll position to match source editor position.
         */
        syncPreviewToSource() {
            if (!this.scrollMap || this.scrollMap.anchors.length === 0) {
                this.buildScrollMap();
                if (!this.scrollMap || this.scrollMap.anchors.length === 0) return;
            }

            // Calculate source line at viewport top
            const lineHeight = this.getSourceLineHeight();
            const sourceTopLine = Math.floor(this.editor.scrollTop / lineHeight) + 1;
            const lineFraction = (this.editor.scrollTop % lineHeight) / lineHeight;

            // Find bracketing anchors
            const { lower, upper } = this.findBracketingAnchors(sourceTopLine);

            // Interpolate preview position
            let previewScrollTop = 0;

            if (lower && upper && upper.sourceLine > lower.sourceLine) {
                const sourceSpan = upper.sourceLine - lower.sourceLine;
                const previewSpan = upper.previewTop - lower.previewTop;
                const progress = (sourceTopLine - lower.sourceLine + lineFraction) / sourceSpan;
                previewScrollTop = lower.previewTop + (progress * previewSpan);
            } else if (lower) {
                // At or past last anchor - extrapolate if possible
                previewScrollTop = lower.previewTop;
                if (lineFraction > 0 && lower.previewHeight) {
                    previewScrollTop += lineFraction * lower.previewHeight;
                }
            } else if (upper) {
                // Before first anchor
                const progress = sourceTopLine / upper.sourceLine;
                previewScrollTop = progress * upper.previewTop;
            }

            this.scrollPreviewTo(Math.max(0, previewScrollTop));
        }

        /**
         * Sync source editor scroll position to match preview position.
         */
        syncSourceToPreview() {
            if (!this.scrollMap || this.scrollMap.anchors.length === 0) {
                this.buildScrollMap();
                if (!this.scrollMap || this.scrollMap.anchors.length === 0) return;
            }

            const previewScrollTop = this.preview.scrollTop;
            const { lower, upper } = this.findBracketingAnchorsByPreviewPos(previewScrollTop);

            if (!lower && !upper) {
                this.scrollSourceTo(0);
                return;
            }

            // Interpolate source line
            let sourceLine = 1;

            if (lower && upper && upper.previewTop > lower.previewTop) {
                const previewSpan = upper.previewTop - lower.previewTop;
                const sourceSpan = upper.sourceLine - lower.sourceLine;
                const progress = (previewScrollTop - lower.previewTop) / previewSpan;
                sourceLine = lower.sourceLine + (progress * sourceSpan);
            } else if (lower) {
                sourceLine = lower.sourceLine;
                // Extrapolate within element if we have height info
                if (lower.previewHeight > 0) {
                    const withinElement = previewScrollTop - lower.previewTop;
                    const fraction = Math.min(1, withinElement / lower.previewHeight);
                    sourceLine += fraction;
                }
            } else if (upper) {
                // Before first anchor
                const progress = previewScrollTop / upper.previewTop;
                sourceLine = progress * upper.sourceLine;
            }

            // Convert line to scroll position
            const lineHeight = this.getSourceLineHeight();
            const sourceScrollTop = (sourceLine - 1) * lineHeight;

            this.scrollSourceTo(Math.max(0, sourceScrollTop));
        }

        /**
         * Find anchors bracketing the given source line.
         * @param {number} targetLine - Target source line number
         * @returns {{lower: Object|null, upper: Object|null}}
         */
        findBracketingAnchors(targetLine) {
            const anchors = this.scrollMap?.anchors || [];
            let lower = null;
            let upper = null;

            for (const anchor of anchors) {
                if (anchor.sourceLine <= targetLine) {
                    lower = anchor;
                } else {
                    upper = anchor;
                    break;
                }
            }

            return { lower, upper };
        }

        /**
         * Find anchors bracketing the given preview scroll position.
         * @param {number} targetPos - Target preview scroll position in pixels
         * @returns {{lower: Object|null, upper: Object|null}}
         */
        findBracketingAnchorsByPreviewPos(targetPos) {
            const anchors = this.scrollMap?.anchors || [];
            let lower = null;
            let upper = null;

            for (const anchor of anchors) {
                if (anchor.previewTop <= targetPos) {
                    lower = anchor;
                } else {
                    upper = anchor;
                    break;
                }
            }

            return { lower, upper };
        }

        /**
         * Get the line height of the source editor.
         * Cached for performance.
         * @returns {number} Line height in pixels
         */
        getSourceLineHeight() {
            if (this._cachedLineHeight) return this._cachedLineHeight;

            const style = getComputedStyle(this.editor);
            let lineHeight = parseFloat(style.lineHeight);

            if (isNaN(lineHeight) || lineHeight === 0) {
                // Fallback: use font size * 1.8
                lineHeight = parseFloat(style.fontSize) * 1.8;
            }

            this._cachedLineHeight = lineHeight;
            return lineHeight;
        }

        /**
         * Scroll preview to position with lock to prevent feedback.
         * @param {number} scrollTop - Target scroll position
         */
        scrollPreviewTo(scrollTop) {
            this.isLocked = true;
            this.preview.scrollTop = scrollTop;
            setTimeout(() => { this.isLocked = false; }, 50);
        }

        /**
         * Scroll source editor to position with lock to prevent feedback.
         * @param {number} scrollTop - Target scroll position
         */
        scrollSourceTo(scrollTop) {
            this.isLocked = true;
            this.editor.scrollTop = scrollTop;
            setTimeout(() => { this.isLocked = false; }, 50);
        }

        /**
         * Capture current scroll position for restoration after mode switch.
         * @param {string} currentMode - Current mode ('source' or 'preview')
         * @returns {Object} Position object with type and line/fraction or scrollTop
         */
        capturePosition(currentMode) {
            const lineHeight = this.getSourceLineHeight();
            console.log('[ScrollSync] capturePosition called, currentMode:', currentMode);

            if (currentMode === 'source') {
                // Capture from source editor directly
                const line = Math.floor(this.editor.scrollTop / lineHeight) + 1;
                const fraction = (this.editor.scrollTop % lineHeight) / lineHeight;
                const maxScroll = this.editor.scrollHeight - this.editor.clientHeight;
                const sourceRatio = maxScroll > 0 ? this.editor.scrollTop / maxScroll : 0;

                const position = {
                    type: 'line',
                    line: line,
                    fraction: fraction,
                    sourceScrollTop: this.editor.scrollTop,
                    sourceRatio: sourceRatio
                };
                console.log('[ScrollSync] captured from source:', position);
                return position;
            } else {
                // Capture from preview - convert preview position to source line
                if (!this.scrollMap) this.buildScrollMap();

                const previewScrollTop = this.preview.scrollTop;
                const previewRatio = this.preview.scrollHeight > this.preview.clientHeight
                    ? previewScrollTop / (this.preview.scrollHeight - this.preview.clientHeight)
                    : 0;

                // Try to find source line from preview position using anchors
                let line = 1;
                let fraction = 0;

                if (this.scrollMap && this.scrollMap.anchors.length > 0) {
                    const { lower, upper } = this.findBracketingAnchorsByPreviewPos(previewScrollTop);

                    if (lower && upper && upper.previewTop > lower.previewTop) {
                        const previewSpan = upper.previewTop - lower.previewTop;
                        const sourceSpan = upper.sourceLine - lower.sourceLine;
                        const progress = (previewScrollTop - lower.previewTop) / previewSpan;
                        const sourceLine = lower.sourceLine + (progress * sourceSpan);
                        line = Math.floor(sourceLine);
                        fraction = sourceLine - line;
                    } else if (lower) {
                        line = lower.sourceLine;
                        if (lower.previewHeight > 0) {
                            fraction = Math.min(1, (previewScrollTop - lower.previewTop) / lower.previewHeight);
                        }
                    }
                }

                const position = {
                    type: 'line',
                    line: line,
                    fraction: fraction,
                    previewScrollTop: previewScrollTop,
                    previewRatio: previewRatio
                };
                console.log('[ScrollSync] captured from preview:', position, 'anchors:', this.scrollMap?.anchors?.length || 0);
                return position;
            }
        }

        /**
         * Restore scroll position after mode switch or render.
         * Uses anchor-based interpolation for accuracy, with ratio fallback.
         * @param {Object} position - Position object from capturePosition()
         * @param {string} targetMode - 'source' or 'preview'
         */
        restorePosition(position, targetMode) {
            if (!position) return;
            console.log('[ScrollSync] restorePosition called, targetMode:', targetMode, 'position:', position);

            // Rebuild scroll map for fresh anchor data
            this.buildScrollMap();
            const hasAnchors = this.scrollMap && this.scrollMap.anchors.length >= 2;
            console.log('[ScrollSync] anchors available:', hasAnchors ? this.scrollMap.anchors.length : 0);

            if (targetMode === 'preview') {
                // Restoring to preview mode - use ratio-based restoration
                // This handles documents where preview height differs from source
                // (e.g., documents with many images that expand preview)
                const maxScroll = this.preview.scrollHeight - this.preview.clientHeight;
                const ratio = position.sourceRatio !== undefined ? position.sourceRatio : position.previewRatio;

                if (maxScroll > 0 && ratio >= 0) {
                    const targetScroll = ratio * maxScroll;
                    console.log('[ScrollSync] ratio-based preview restore: ratio=', ratio, 'targetScroll=', targetScroll);
                    this.applyPreviewScroll(targetScroll, 'ratio-based');
                }
            } else {
                // Restoring to source mode - use ratio-based restoration with enforcement
                const maxScroll = this.editor.scrollHeight - this.editor.clientHeight;
                const ratio = position.previewRatio !== undefined ? position.previewRatio : position.sourceRatio;

                if (maxScroll > 0 && ratio >= 0) {
                    const targetScroll = ratio * maxScroll;
                    console.log('[ScrollSync] ratio-based source restore: ratio=', ratio, 'targetScroll=', targetScroll);
                    this.applySourceScroll(targetScroll, 'ratio-based');
                }
            }
        }

        /**
         * Apply scroll position to source editor with continuous enforcement.
         * Keeps applying scroll position for 600ms to prevent any resets.
         * @param {number} targetScroll - Target scroll position
         * @param {string} label - Debug label for logging
         */
        applySourceScroll(targetScroll, label) {
            this.isLocked = true;
            const startTime = Date.now();
            const enforceDuration = 600;
            let logged = false;

            const enforceScroll = () => {
                const elapsed = Date.now() - startTime;

                // Force layout read before scroll
                const _ = this.editor.offsetHeight;

                // Always set scroll
                this.editor.scrollTop = targetScroll;

                if (!logged) {
                    console.log(`[ScrollSync] ${label} source restore: applied=${this.editor.scrollTop}, target=${targetScroll}`);
                    logged = true;
                }

                if (elapsed < enforceDuration) {
                    requestAnimationFrame(enforceScroll);
                } else {
                    this.isLocked = false;
                    console.log(`[ScrollSync] ${label} source enforcement complete after ${elapsed}ms, final=${this.editor.scrollTop}`);
                }
            };

            requestAnimationFrame(enforceScroll);
        }

        /**
         * Apply scroll position to preview with continuous enforcement.
         * Keeps applying scroll position for 600ms to prevent any resets.
         * @param {number} targetScroll - Target scroll position
         * @param {string} label - Debug label for logging
         */
        applyPreviewScroll(targetScroll, label) {
            this.isLocked = true;
            const startTime = Date.now();
            const enforceDuration = 600; // Keep enforcing for 600ms
            let logged = false;

            const enforceScroll = () => {
                const elapsed = Date.now() - startTime;

                // Force layout read before scroll
                const _ = this.preview.offsetHeight;

                // Always set scroll - don't check if it matches
                this.preview.scrollTop = targetScroll;

                if (!logged) {
                    console.log(`[ScrollSync] ${label} preview restore: applied=${this.preview.scrollTop}, target=${targetScroll}`);
                    logged = true;
                }

                // Keep enforcing until duration expires
                if (elapsed < enforceDuration) {
                    requestAnimationFrame(enforceScroll);
                } else {
                    // Done enforcing
                    this.isLocked = false;
                    console.log(`[ScrollSync] ${label} enforcement complete after ${elapsed}ms, final=${this.preview.scrollTop}`);
                }
            };

            // Start enforcement loop
            requestAnimationFrame(enforceScroll);
        }

        /**
         * Invalidate cached values (call after font/style changes).
         */
        invalidateCache() {
            this._cachedLineHeight = null;
            this.scrollMap = null;
        }

        /**
         * Clean up resources.
         */
        destroy() {
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
                this.resizeObserver = null;
            }
            clearTimeout(this.rebuildTimer);
            clearTimeout(this.scrollTimer);
        }
    }

    // Export to global scope
    window.ScrollSyncController = ScrollSyncController;

})();
