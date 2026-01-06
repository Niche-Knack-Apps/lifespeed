/**
 * Frontmatter Parser for At the Speed of Life
 * Handles YAML frontmatter parsing and generation
 */

const frontmatter = {
    /**
     * Parse markdown content with YAML frontmatter
     * @param {string} content - Full markdown content
     * @returns {{ data: object, body: string, raw: string }}
     */
    parse(content) {
        const result = {
            data: {},
            body: content,
            raw: ''
        };

        if (!content || !content.startsWith('---')) {
            return result;
        }

        // Find the closing ---
        const endIndex = content.indexOf('\n---', 3);
        if (endIndex === -1) {
            return result;
        }

        const frontmatterRaw = content.substring(4, endIndex);
        result.raw = frontmatterRaw;
        result.body = content.substring(endIndex + 4).trim();

        // Parse YAML (simple parser for our use case)
        result.data = this.parseYAML(frontmatterRaw);

        return result;
    },

    /**
     * Simple YAML parser for frontmatter
     * Handles: strings, arrays, booleans, dates
     */
    parseYAML(yaml) {
        const data = {};
        const lines = yaml.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip empty lines
            if (!line.trim()) continue;

            // Parse key: value
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;

            const key = line.substring(0, colonIndex).trim();
            let value = line.substring(colonIndex + 1).trim();

            // Handle arrays in bracket notation [a, b, c]
            if (value.startsWith('[') && value.endsWith(']')) {
                const arrayContent = value.slice(1, -1);
                data[key] = arrayContent.split(',').map(item => {
                    item = item.trim();
                    // Remove quotes if present
                    if ((item.startsWith('"') && item.endsWith('"')) ||
                        (item.startsWith("'") && item.endsWith("'"))) {
                        item = item.slice(1, -1);
                    }
                    return item;
                }).filter(item => item.length > 0);
                continue;
            }

            // Handle multi-line arrays (YAML list format)
            if (value === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('-')) {
                data[key] = [];
                while (i + 1 < lines.length && lines[i + 1].trim().startsWith('-')) {
                    i++;
                    const listItem = lines[i].trim().substring(1).trim();
                    data[key].push(this.parseValue(listItem));
                }
                continue;
            }

            // Parse value
            data[key] = this.parseValue(value);
        }

        return data;
    },

    /**
     * Parse a single YAML value
     */
    parseValue(value) {
        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }

        // Booleans
        if (value === 'true') return true;
        if (value === 'false') return false;

        // Numbers
        if (/^-?\d+$/.test(value)) return parseInt(value, 10);
        if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

        // null/empty
        if (value === 'null' || value === '~' || value === '') return null;

        return value;
    },

    /**
     * Generate frontmatter string from data object
     * @param {object} data - Frontmatter data
     * @param {string} body - Optional markdown body to append
     * @returns {string} YAML frontmatter with delimiters (and body if provided)
     */
    stringify(data, body = '') {
        let yaml = '---\n';

        for (const [key, value] of Object.entries(data)) {
            if (value === undefined) continue;

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    yaml += `${key}: []\n`;
                } else {
                    yaml += `${key}: [${value.map(v => this.formatValue(v)).join(', ')}]\n`;
                }
            } else {
                yaml += `${key}: ${this.formatValue(value)}\n`;
            }
        }

        yaml += '---\n';

        // Append body if provided
        if (body) {
            yaml += '\n' + body;
        }

        return yaml;
    },

    /**
     * Format a value for YAML output
     */
    formatValue(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value.toString();
        if (typeof value === 'number') return value.toString();

        // Strings that need quoting
        const str = String(value);
        if (str.includes(':') || str.includes('#') || str.includes('\n') ||
            str.startsWith(' ') || str.endsWith(' ') ||
            str.startsWith('"') || str.startsWith("'")) {
            return `"${str.replace(/"/g, '\\"')}"`;
        }

        return str;
    },

    /**
     * Update frontmatter in existing content
     * @param {string} content - Full markdown content
     * @param {object} updates - Fields to update
     * @returns {string} Updated content
     */
    updateInContent(content, updates) {
        const parsed = this.parse(content);

        // Merge updates into existing data
        const newData = { ...parsed.data, ...updates };

        // Generate new frontmatter
        const newFrontmatter = this.stringify(newData);

        // Return with body
        return newFrontmatter + '\n' + parsed.body;
    },

    /**
     * Generate default frontmatter for a new entry
     * @param {string} title - Entry title
     * @returns {string} Default frontmatter
     */
    generateDefault(title = '') {
        const now = new Date().toISOString();
        return this.stringify({
            title: title,
            date: now,
            lastmod: now,
            tags: [],
            draft: false
        });
    },

    /**
     * Generate filename slug from title
     * @param {string} title - Entry title
     * @returns {string} URL-safe slug
     */
    slugify(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 50);
    },

    /**
     * Generate entry directory name
     * @param {string} title - Entry title
     * @param {Date} date - Entry date (optional, defaults to now)
     * @returns {string} Directory name in format YYYY-MM-DD-slug
     */
    generateDirname(title, date = new Date()) {
        const dateStr = date.toISOString().slice(0, 10);
        const slug = title ? this.slugify(title) : date.toTimeString().slice(0, 8).replace(/:/g, '-');
        return `${dateStr}-${slug}`;
    }
};
