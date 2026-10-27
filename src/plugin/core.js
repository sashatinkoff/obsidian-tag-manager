"use strict";
/** Ядро плагина: жизненный цикл, настройки, сканирование индекса тегов. */
const { Notice } = require("obsidian");
const { DEFAULT_SETTINGS, NON_DATE_PROPERTIES, VIEW_TYPE } = require("../constants.js");
const { getFrontmatterProperty, parseCreationDate } = require("../dates.js");
const { buildFileTagMap, sameTagIndex, scanTagIndex } = require("../scanner.js");
const { TagAuditorSettingTab } = require("../settings-tab.js");
const { clampNumber } = require("../utils.js");
const { TagAuditorView } = require("../view/tag-auditor-view.js");

/**
 * Методы подмешиваются в класс плагина из корневого main.js.
 * initState() заменяет конструктор, start() / stop() — onload() / onunload().
 */
class PluginCoreMixin {
    initState() {
        this.settings = { ...DEFAULT_SETTINGS };
        this.tagIndex = new Map();
        this.pendingChanges = new Map();
        this.pendingAdditions = new Map();
        this.lastUndo = new Map();
        this.lastUndoLabel = "";
        this.fileTags = new Map();
        this.creationTimes = new Map();
        this.dateCandidates = null;
        this.isScanning = false;
        this.isApplying = false;
        this.indexDirty = true;
        this.lastScanTime = 0;
        this.debounceTimer = null;
        this.settingsTimer = null;
    }
    async start() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE, (leaf) => new TagAuditorView(leaf, this));
        this.addRibbonIcon("tags", "Tag Refactor & Auditor", () => void this.activateView());
        this.addCommand({
            id: "open-tag-refactor-auditor",
            name: "Open Tag Refactor & Auditor",
            callback: () => void this.activateView(),
        });
        this.addCommand({
            id: "rescan-tags",
            name: "Rescan tags",
            callback: () => void this.scanTags({ force: true }).then(() => new Notice("Сканирование тегов завершено.")),
        });
        this.addCommand({
            id: "undo-last-refactor",
            name: "Undo last tag refactor",
            checkCallback: (checking) => {
                if (checking)
                    return this.lastUndo.size > 0;
                void this.undoLastBatch();
                return true;
            },
        });
        this.addSettingTab(new TagAuditorSettingTab(this.app, this));
        // The metadata cache is the source of truth for tags. Vault "modify" and
        // "create" fire before the cache is updated, so they would only trigger a
        // scan against stale data; "changed" follows every re-index instead and
        // "resolved" covers the initial indexing after startup.
        this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleScan()));
        this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("delete", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("rename", () => this.scheduleScan()));
        this.app.workspace.onLayoutReady(() => {
            if (this.hasOpenView())
                void this.scanTags({ force: true });
        });
    }
    stop() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        if (this.settingsTimer !== null)
            window.clearTimeout(this.settingsTimer);
    }
    async loadSettings() {
        const loaded = (await this.loadData());
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(loaded ?? {}),
            previewChars: clampNumber(loaded?.previewChars, 80, 1200, DEFAULT_SETTINGS.previewChars),
            caseSensitive: Boolean(loaded?.caseSensitive ?? DEFAULT_SETTINGS.caseSensitive),
            ignoredFolders: Array.isArray(loaded?.ignoredFolders)
                ? loaded.ignoredFolders.filter((path) => typeof path === "string")
                : [...DEFAULT_SETTINGS.ignoredFolders],
            createdDateProperty: typeof loaded?.createdDateProperty === "string"
                ? loaded.createdDateProperty.trim()
                : DEFAULT_SETTINGS.createdDateProperty,
            fileDateField: loaded?.fileDateField === "mtime" ? "mtime" : "ctime",
            minTagMentions: clampNumber(loaded?.minTagMentions, 0, 1000000, DEFAULT_SETTINGS.minTagMentions),
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        // Settings fields save on every keystroke; rescan once typing pauses.
        if (this.settingsTimer !== null)
            window.clearTimeout(this.settingsTimer);
        this.settingsTimer = window.setTimeout(() => {
            this.settingsTimer = null;
            this.creationTimes.clear();
            this.dateCandidates = null;
            if (this.hasOpenView())
                void this.scanTags({ force: true });
            else
                this.indexDirty = true;
        }, 400);
    }
    async activateView() {
        const workspace = this.app.workspace;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE);
        const rootLeaves = new Set();
        workspace.iterateRootLeaves((rootLeaf) => rootLeaves.add(rootLeaf));

        // Reuse the view if it is already in the main workspace area. If an older
        // version left it in a sidebar, detach that instance and recreate it as a
        // normal center-area tab.
        let leaf = leaves.find((candidate) => rootLeaves.has(candidate));
        for (const existingLeaf of leaves) {
            if (existingLeaf !== leaf)
                existingLeaf.detach();
        }

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }
    hasOpenView() {
        return this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0;
    }
    /**
     * Rebuild the tag index. Views are re-rendered only when the set of tags or
     * the notes that carry them actually changed, so ordinary typing in a note
     * does not rebuild the whole screen; `force` always re-renders.
     */
    async scanTags(options = {}) {
        const { force = false, render = true } = options;
        if (this.isScanning)
            return false;
        this.isScanning = true;
        let changed = false;
        try {
            if (this.debounceTimer !== null) {
                window.clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            const next = scanTagIndex(this.app, this.settings);
            changed = force || !sameTagIndex(this.tagIndex, next);
            this.tagIndex = next;
            this.fileTags = buildFileTagMap(next);
            this.creationTimes.clear();
            this.dateCandidates = null;
            this.lastScanTime = Date.now();
            this.indexDirty = false;
        }
        finally {
            this.isScanning = false;
        }
        if (changed && render)
            this.refreshViews();
        return changed;
    }
    /** Make sure the index reflects the vault before it is shown or used for writes. */
    async ensureFreshIndex() {
        if (this.indexDirty || this.debounceTimer !== null || this.tagIndex.size === 0)
            await this.scanTags({ force: true, render: false });
    }
    scheduleScan() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        // Nobody looks at the index while the view is closed: just remember that
        // it is stale and rebuild it when the view opens.
        if (!this.hasOpenView()) {
            this.indexDirty = true;
            return;
        }
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.scanTags();
        }, 500);
    }
    refreshViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            if (leaf.view instanceof TagAuditorView)
                leaf.view.requestRender();
        }
    }
    getTagsForFile(file) {
        return this.fileTags.get(file.path) ?? [];
    }
    /** Creation date used for sorting and filtering, cached until the next scan. */
    getNoteCreationTimestamp(file) {
        const cached = this.creationTimes.get(file.path);
        if (cached !== undefined)
            return cached;
        const property = (this.settings.createdDateProperty ?? "").trim();
        let value;
        if (!property) {
            value = (this.settings.fileDateField === "mtime" ? file.stat?.mtime : file.stat?.ctime) ?? 0;
        }
        else {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            value = parseCreationDate(getFrontmatterProperty(frontmatter, property));
        }
        this.creationTimes.set(file.path, value);
        return value;
    }
    /** Human-readable name of the current date source. */
    describeDateSource() {
        const property = (this.settings.createdDateProperty ?? "").trim();
        if (property)
            return `свойство YAML «${property}»`;
        return this.settings.fileDateField === "mtime" ? "дата изменения файла" : "дата создания файла";
    }
    /**
     * Frontmatter properties that hold parseable dates, with the number of notes
     * for each. File copies and sync tools (Syncthing) reset file creation times,
     * so a YAML date is often the only reliable source. Cached until the next scan.
     */
    getDateFieldCandidates() {
        if (this.dateCandidates)
            return this.dateCandidates;
        const counts = new Map();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter || typeof frontmatter !== "object")
                continue;
            for (const [key, value] of Object.entries(frontmatter)) {
                if (NON_DATE_PROPERTIES.has(key.toLowerCase()) || key === "position")
                    continue;
                if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date))
                    continue;
                if (parseCreationDate(value) > 0)
                    counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        this.dateCandidates = [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 12)
            .map(([key, count]) => ({ key, count }));
        return this.dateCandidates;
    }
    /** Switch the date source used for sorting and date filters. */
    async setDateSource(source) {
        if (source === "ctime" || source === "mtime") {
            this.settings.createdDateProperty = "";
            this.settings.fileDateField = source;
        }
        else {
            this.settings.createdDateProperty = source;
        }
        this.creationTimes.clear();
        await this.saveData(this.settings);
    }
}

module.exports = { PluginCoreMixin };
