/**
 * Search Index for Lifespeed
 * Manages search index building and querying
 * Supports per-journal indexes via journalId
 */

const SEARCH_STOPWORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an',
    'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
    'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
    'doing', 'done', 'down', 'during', 'each', 'even', 'every', 'few', 'for',
    'from', 'further', 'get', 'gets', 'got', 'had', 'has', 'have', 'having', 'he',
    'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if',
    'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'know', 'let', 'like',
    'make', 'me', 'might', 'more', 'most', 'much', 'must', 'my', 'myself', 'no',
    'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
    'ours', 'ourselves', 'out', 'over', 'own', 'really', 'same', 'say', 'she',
    'should', 'so', 'some', 'still', 'such', 'take', 'than', 'that', 'the',
    'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
    'thing', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
    'upon', 'us', 'very', 'want', 'was', 'way', 'we', 'well', 'were', 'what',
    'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
    'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

function stripStopwords(text) {
    if (!text) return '';
    return text.split(/\s+/).filter(w => !SEARCH_STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))).join(' ');
}

const search = {
    index: null,
    fuse: null,
    currentJournalId: null,

    async init(journalId) {
        this.currentJournalId = journalId || null;
        const result = await platform.loadIndex(journalId);
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

    async rebuildIndex(journalId) {
        const jid = journalId || this.currentJournalId;
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
                content: stripStopwords(parsed.body)
            });

            // Count tags
            for (const tag of (parsed.data.tags || [])) {
                this.index.tags[tag] = (this.index.tags[tag] || 0) + 1;
            }
        }

        await platform.saveIndex(this.index, jid);
        this.initFuse();
    },

    /**
     * Reset search state (used when switching journals)
     * Index will be lazy-loaded on next search
     */
    reset() {
        this.index = null;
        this.fuse = null;
        this.currentJournalId = null;
    }
};
