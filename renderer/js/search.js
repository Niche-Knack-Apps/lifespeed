/**
 * Search Index for At the Speed of Life
 * Manages search index building and querying
 */

const search = {
    index: null,
    fuse: null,

    async init() {
        const result = await platform.loadIndex();
        if (result.success && result.index) {
            this.index = result.index;
            this.initFuse();
        }
    },

    initFuse() {
        if (!this.index || !this.index.entries) return;

        // Fuse.js will be loaded externally
        if (typeof Fuse !== 'undefined') {
            this.fuse = new Fuse(this.index.entries, {
                keys: [
                    { name: 'title', weight: 0.4 },
                    { name: 'tags', weight: 0.3 },
                    { name: 'content', weight: 0.2 },
                    { name: 'date', weight: 0.1 }
                ],
                threshold: 0.4,
                ignoreLocation: true,
                includeScore: true,
                includeMatches: true
            });
        }
    },

    search(query) {
        if (!this.fuse) return [];
        return this.fuse.search(query);
    },

    async rebuildIndex() {
        // TODO: Implement full index rebuild
        const entries = await platform.listEntries();
        if (!entries.success) return;

        this.index = {
            version: 1,
            lastUpdated: new Date().toISOString(),
            entries: [],
            tags: {}
        };

        for (const entry of entries.entries) {
            const result = await platform.loadEntry(entry.path);
            if (!result.success) continue;

            const parsed = frontmatter.parse(result.content);
            this.index.entries.push({
                path: entry.path,
                dirname: entry.dirname,
                title: parsed.data.title || '',
                date: parsed.data.date || '',
                tags: parsed.data.tags || [],
                excerpt: parsed.body.substring(0, 300),
                content: parsed.body
            });

            // Count tags
            for (const tag of (parsed.data.tags || [])) {
                this.index.tags[tag] = (this.index.tags[tag] || 0) + 1;
            }
        }

        await platform.saveIndex(this.index);
        this.initFuse();
    }
};
