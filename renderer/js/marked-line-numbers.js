/**
 * marked-line-numbers.js
 *
 * Line tracking extension for marked.js using walkTokens hook.
 * Injects data-source-line attributes into block-level elements.
 *
 * Compatible with marked.js v11+
 *
 * IMPORTANT: marked v11 renderer signatures vary by element type:
 * - heading({ text, depth, raw }) - HAS raw
 * - code({ text, lang, escaped }) - text IS the raw code
 * - paragraph({ text }) - text is RENDERED HTML, no raw
 * - list({ body, ordered, start }) - body is RENDERED, no raw
 * - etc.
 *
 * Strategy: Use walkTokens to build multiple lookup maps, then use
 * whatever identifier is available in each renderer.
 */

(function() {
    'use strict';

    let currentLine = 1;
    let frontmatterEndLine = 0;
    let sourceLines = [];

    // Multiple maps for different lookup strategies
    const lineByRaw = new Map();      // raw content -> line
    const lineByText = new Map();     // stripped text content -> line
    let lineCounter = 0;              // Sequential line for elements without good keys

    function resetLineCounter(markdown) {
        sourceLines = markdown.split('\n');
        currentLine = 1;
        frontmatterEndLine = 0;
        lineByRaw.clear();
        lineByText.clear();
        lineCounter = 0;

        // Detect and skip frontmatter
        if (markdown.startsWith('---')) {
            const rest = markdown.substring(3);
            const endIndex = rest.indexOf('\n---');
            if (endIndex > 0) {
                frontmatterEndLine = markdown.substring(0, endIndex + 7).split('\n').length;
                currentLine = frontmatterEndLine + 1;
            }
        }
    }

    // Strip HTML tags and decode entities for text matching
    function stripHtml(html) {
        if (!html) return '';
        return html
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim()
            .substring(0, 50); // Use first 50 chars as key
    }

    function getCacheKey(raw) {
        if (!raw) return '';
        return raw.substring(0, 100);
    }

    function walkTokens(token) {
        if (!token.raw) return;

        const rawFirstLine = token.raw.split('\n')[0].trim();
        if (!rawFirstLine) {
            const key = getCacheKey(token.raw);
            lineByRaw.set(key, currentLine);
            return;
        }

        let foundLine = null;
        const searchPrefix = rawFirstLine.substring(0, Math.min(30, rawFirstLine.length));

        for (let i = currentLine - 1; i < sourceLines.length; i++) {
            const sourceLine = sourceLines[i].trim();
            if (sourceLine === rawFirstLine ||
                (searchPrefix.length >= 3 && sourceLine.startsWith(searchPrefix))) {
                foundLine = i + 1;
                break;
            }
        }

        const line = foundLine || currentLine;

        // Store in raw map
        const rawKey = getCacheKey(token.raw);
        lineByRaw.set(rawKey, line);

        // Also store by text content (for paragraph matching)
        if (token.text) {
            const textKey = stripHtml(token.text);
            if (textKey) {
                lineByText.set(textKey, line);
            }
        }

        // Advance line counter
        if (foundLine) {
            const tokenLines = token.raw.split('\n').length;
            currentLine = foundLine + tokenLines;
        } else {
            currentLine += token.raw.split('\n').length;
        }
    }

    function getLineForRaw(raw) {
        if (!raw) return ++lineCounter;
        const key = getCacheKey(raw);
        return lineByRaw.get(key) || ++lineCounter;
    }

    function getLineForText(text) {
        if (!text) return ++lineCounter;
        const key = stripHtml(text);
        return lineByText.get(key) || ++lineCounter;
    }

    /**
     * Custom renderers - handle both string and object inputs.
     * marked v11 passes different types to different renderers.
     */
    const renderer = {
        // heading receives { text, depth, raw } - HAS raw
        heading(arg) {
            if (typeof arg === 'string') {
                return `<h1 data-source-line="${++lineCounter}">${arg}</h1>\n`;
            }
            const { text, depth, raw } = arg;
            const line = getLineForRaw(raw);
            return `<h${depth} data-source-line="${line}">${text}</h${depth}>\n`;
        },

        // paragraph receives { text } - text is RENDERED HTML, no raw
        paragraph(arg) {
            if (typeof arg === 'string') {
                const line = getLineForText(arg);
                return `<p data-source-line="${line}">${arg}</p>\n`;
            }
            const { text } = arg;
            const line = getLineForText(text);
            return `<p data-source-line="${line}">${text}</p>\n`;
        },

        // code receives { text, lang, escaped } - text IS raw code
        code(arg) {
            if (typeof arg === 'string') {
                return `<pre data-source-line="${++lineCounter}"><code>${arg}</code></pre>\n`;
            }
            const { text, lang, escaped } = arg;
            const line = getLineForRaw(text); // For code blocks, text is the raw code
            const code = escaped ? text : (text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            const langClass = lang ? ` class="language-${lang}"` : '';
            return `<pre data-source-line="${line}"><code${langClass}>${code}</code></pre>\n`;
        },

        // blockquote receives { quote } - quote is RENDERED HTML
        blockquote(arg) {
            if (typeof arg === 'string') {
                return `<blockquote data-source-line="${++lineCounter}">${arg}</blockquote>\n`;
            }
            const { quote } = arg;
            const line = ++lineCounter; // Can't reliably match blockquote content
            return `<blockquote data-source-line="${line}">${quote}</blockquote>\n`;
        },

        // list receives { body, ordered, start } - body is RENDERED HTML
        list(arg) {
            if (typeof arg === 'string') {
                return `<ul data-source-line="${++lineCounter}">\n${arg}</ul>\n`;
            }
            const { body, ordered, start } = arg;
            const tag = ordered ? 'ol' : 'ul';
            const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
            const line = ++lineCounter;
            return `<${tag}${startAttr} data-source-line="${line}">\n${body}</${tag}>\n`;
        },

        // listitem receives { text, task, checked } - text is RENDERED
        listitem(arg) {
            if (typeof arg === 'string') {
                return `<li data-source-line="${++lineCounter}">${arg}</li>\n`;
            }
            const { text, task, checked } = arg;
            const line = ++lineCounter;
            if (task) {
                const checkbox = `<input type="checkbox"${checked ? ' checked' : ''} disabled> `;
                return `<li data-source-line="${line}" class="task-list-item">${checkbox}${text}</li>\n`;
            }
            return `<li data-source-line="${line}">${text}</li>\n`;
        },

        // hr receives {} or nothing
        hr(arg) {
            const line = ++lineCounter;
            return `<hr data-source-line="${line}">\n`;
        },

        // table receives { header, body } - both are RENDERED HTML
        table(arg) {
            if (typeof arg === 'string') {
                return `<table data-source-line="${++lineCounter}">\n${arg}</table>\n`;
            }
            const { header, body } = arg;
            const line = ++lineCounter;
            let html = `<table data-source-line="${line}">\n`;
            if (header) html += `<thead>\n${header}</thead>\n`;
            if (body) html += `<tbody>\n${body}</tbody>\n`;
            html += '</table>\n';
            return html;
        },

        tablerow(arg) {
            const content = typeof arg === 'string' ? arg : arg.content;
            return `<tr>\n${content}</tr>\n`;
        },

        tablecell(arg) {
            if (typeof arg === 'string') {
                return `<td>${arg}</td>\n`;
            }
            const { content, flags } = arg;
            const tag = flags?.header ? 'th' : 'td';
            const align = flags?.align ? ` style="text-align:${flags.align}"` : '';
            return `<${tag}${align}>${content}</${tag}>\n`;
        },

        // html receives { text } or string
        html(arg) {
            const text = typeof arg === 'string' ? arg : arg.text;
            const line = ++lineCounter;
            const trimmed = (text || '').trim();
            if (trimmed.startsWith('<div') || trimmed.startsWith('<section') ||
                trimmed.startsWith('<article') || trimmed.startsWith('<aside') ||
                trimmed.startsWith('<header') || trimmed.startsWith('<footer') ||
                trimmed.startsWith('<nav') || trimmed.startsWith('<main')) {
                return text.replace(/^(<\w+)/, `$1 data-source-line="${line}"`);
            }
            return text;
        }
    };

    function createExtension() {
        return {
            walkTokens,
            renderer
        };
    }

    function getDebugInfo() {
        return {
            currentLine,
            frontmatterEndLine,
            totalSourceLines: sourceLines.length,
            lineByRawSize: lineByRaw.size,
            lineByTextSize: lineByText.size,
            lineCounter
        };
    }

    window.markedLineNumbers = {
        resetLineCounter,
        createExtension,
        getDebugInfo
    };

})();
