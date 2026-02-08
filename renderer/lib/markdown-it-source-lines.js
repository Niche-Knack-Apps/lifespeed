/**
 * markdown-it-source-lines
 *
 * Plugin that adds data-source-line attributes to block-level elements.
 * Based on the approach used by VS Code and Joplin.
 *
 * Usage:
 *   const md = markdownit().use(markdownItSourceLines);
 *   const html = md.render(markdown);
 */
(function(global) {
    'use strict';

    function markdownItSourceLines(md) {
        // Store original render rules
        const defaultRender = {
            paragraph_open: md.renderer.rules.paragraph_open,
            heading_open: md.renderer.rules.heading_open,
            blockquote_open: md.renderer.rules.blockquote_open,
            bullet_list_open: md.renderer.rules.bullet_list_open,
            ordered_list_open: md.renderer.rules.ordered_list_open,
            list_item_open: md.renderer.rules.list_item_open,
            code_block: md.renderer.rules.code_block,
            fence: md.renderer.rules.fence,
            table_open: md.renderer.rules.table_open,
            hr: md.renderer.rules.hr
        };

        // Helper to add data-source-line to opening tags
        function addLineAttr(tokens, idx, options, env, self, defaultFn) {
            const token = tokens[idx];
            if (token.map && token.map[0] !== null) {
                // map[0] is the starting line (0-indexed), add 1 for 1-indexed
                token.attrSet('data-source-line', token.map[0] + 1);
            }
            if (defaultFn) {
                return defaultFn(tokens, idx, options, env, self);
            }
            return self.renderToken(tokens, idx, options);
        }

        // Override render rules to add line numbers
        md.renderer.rules.paragraph_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.paragraph_open);
        };

        md.renderer.rules.heading_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.heading_open);
        };

        md.renderer.rules.blockquote_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.blockquote_open);
        };

        md.renderer.rules.bullet_list_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.bullet_list_open);
        };

        md.renderer.rules.ordered_list_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.ordered_list_open);
        };

        md.renderer.rules.list_item_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.list_item_open);
        };

        md.renderer.rules.table_open = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.table_open);
        };

        md.renderer.rules.hr = function(tokens, idx, options, env, self) {
            return addLineAttr(tokens, idx, options, env, self, defaultRender.hr);
        };

        // Code blocks (fenced and indented)
        md.renderer.rules.fence = function(tokens, idx, options, env, self) {
            const token = tokens[idx];
            const lineAttr = token.map ? ` data-source-line="${token.map[0] + 1}"` : '';
            const info = token.info ? md.utils.escapeHtml(token.info.trim()) : '';
            const langClass = info ? ` class="language-${info}"` : '';
            const code = md.utils.escapeHtml(token.content);
            return `<pre${lineAttr}><code${langClass}>${code}</code></pre>\n`;
        };

        md.renderer.rules.code_block = function(tokens, idx, options, env, self) {
            const token = tokens[idx];
            const lineAttr = token.map ? ` data-source-line="${token.map[0] + 1}"` : '';
            const code = md.utils.escapeHtml(token.content);
            return `<pre${lineAttr}><code>${code}</code></pre>\n`;
        };
    }

    // Export for different module systems
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = markdownItSourceLines;
    } else if (typeof define === 'function' && define.amd) {
        define(function() { return markdownItSourceLines; });
    } else {
        global.markdownItSourceLines = markdownItSourceLines;
    }
})(typeof window !== 'undefined' ? window : this);
