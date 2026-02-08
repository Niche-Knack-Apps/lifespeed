/**
 * Tags Management for Lifespeed
 * Tag index and autocomplete
 */

const tags = {
    index: {},

    async init() {
        await this.loadFromIndex();
    },

    async loadFromIndex() {
        const result = await platform.loadIndex();
        if (result.success && result.index && result.index.tags) {
            this.index = result.index.tags;
        }
    },

    getAll() {
        return Object.keys(this.index).sort();
    },

    getSortedByCount() {
        return Object.entries(this.index)
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);
    },

    autocomplete(prefix) {
        const lower = prefix.toLowerCase();
        return this.getAll().filter(tag => tag.toLowerCase().startsWith(lower));
    },

    add(tag) {
        this.index[tag] = (this.index[tag] || 0) + 1;
    },

    remove(tag) {
        if (this.index[tag]) {
            this.index[tag]--;
            if (this.index[tag] <= 0) {
                delete this.index[tag];
            }
        }
    }
};
