"use strict";
/** Экран плагина: жизненный цикл, общая шапка, перерисовка и ленивые предпросмотры. */
const { Component, ItemView, Notice, Platform, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE, VIEW_TYPE } = require("../constants.js");
const { applyMixins, relativeTime } = require("../utils.js");
const { AuditPageMixin } = require("./audit-page.js");
const { BulkPageMixin } = require("./bulk-page.js");

class TagAuditorView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.selectedTag = null;
        this.query = "";
        this.showAllPreviews = false;
        this.tagListScrollTop = 0;
        this.sortMode = "name";
        this.activePage = "audit";
        this.bulkDateFrom = "";
        this.bulkDateTo = "";
        // Filters of the "Заметки по датам" page.
        this.bulkFolder = "";
        this.bulkTagMode = "any";
        this.bulkIncludeTags = [];
        this.bulkExcludeTags = [];
        this.bulkTextQuery = "";
        this.bulkTextMatches = null;
        // Chosen records inside notes: path -> { indices: number[], count }.
        this.bulkPostSelection = new Map();
        this.postSelection = new Map();
        this.bulkFilterApplied = false;
        this.bulkDateSort = "newest";
        this.bulkAlwaysAddToAttributes = false;
        this.bulkAction = "add";
        this.bulkInputs = { add: "", rename: "", delete: "", move: "" };
        this.bulkSelectedPaths = new Set();
        this.bulkVisibleFiles = [];
        this.bulkRenderLimit = BULK_PAGE_SIZE;
        this.renameDraft = { tag: null, value: "", addTags: "" };
        this.renderComponent = null;
        this.renderGeneration = 0;
        this.lazyObserver = null;
        this.lazyLoaders = null;
        this.needsRender = false;
        this.plugin = plugin;
    }
    getViewType() {
        return VIEW_TYPE;
    }
    getDisplayText() {
        return "Tag Refactor & Auditor";
    }
    getIcon() {
        return "tags";
    }
    async onOpen() {
        // Index updates that arrive while this tab is hidden are applied when it
        // becomes visible again instead of rebuilding an invisible DOM.
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.flushPendingRender()));
        this.registerEvent(this.app.workspace.on("layout-change", () => this.flushPendingRender()));
        await this.plugin.ensureFreshIndex();
        this.render();
    }
    async onClose() {
        this.disposeRenderResources();
        this.contentEl.empty();
    }
    isVisible() {
        const el = this.containerEl;
        return typeof el.isShown === "function" ? el.isShown() : el.isConnected;
    }
    /** Re-render on index changes, deferring the work while the tab is hidden. */
    requestRender() {
        if (this.isVisible()) {
            this.needsRender = false;
            this.render();
        }
        else {
            this.needsRender = true;
        }
    }
    flushPendingRender() {
        if (this.needsRender && this.isVisible()) {
            this.needsRender = false;
            this.render();
        }
    }
    /**
     * Markdown previews register child components (embeds, plugin code blocks)
     * on the component passed to MarkdownRenderer. Using a fresh child per
     * render and unloading it here keeps them from piling up on the view.
     */
    disposeRenderResources() {
        this.lazyObserver?.disconnect();
        this.lazyObserver = null;
        this.catalog?.observer?.disconnect();
        this.catalog = null;
        if (this.renderComponent) {
            this.removeChild(this.renderComponent);
            this.renderComponent = null;
        }
    }
    /** Render `loader` only when `el` scrolls near the viewport. */
    renderWhenVisible(el, loader) {
        if (typeof IntersectionObserver === "undefined") {
            void loader();
            return;
        }
        if (!this.lazyObserver) {
            const loaders = new WeakMap();
            const observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting)
                        continue;
                    observer.unobserve(entry.target);
                    const load = loaders.get(entry.target);
                    loaders.delete(entry.target);
                    if (load)
                        void load();
                }
            }, { rootMargin: "300px 0px" });
            this.lazyObserver = observer;
            this.lazyLoaders = loaders;
        }
        this.lazyLoaders.set(el, loader);
        this.lazyObserver.observe(el);
    }
    captureUiState(root) {
        const active = document.activeElement;
        let focus = null;
        if (active instanceof HTMLElement && root.contains(active) && active.dataset.traField) {
            focus = { field: active.dataset.traField, start: null, end: null };
            try {
                focus.start = active.selectionStart ?? null;
                focus.end = active.selectionEnd ?? null;
            }
            catch {
                // Number and date inputs do not expose a selection.
            }
        }
        return {
            focus,
            rootScrollTop: root.scrollTop,
            bulkListScrollTop: root.querySelector(".tra-bulk-note-list")?.scrollTop ?? 0,
        };
    }
    restoreUiState(root, state) {
        const apply = () => {
            if (!root.isConnected)
                return;
            root.scrollTop = state.rootScrollTop;
            const bulkList = root.querySelector(".tra-bulk-note-list");
            if (bulkList)
                bulkList.scrollTop = state.bulkListScrollTop;
        };
        apply();
        window.requestAnimationFrame(apply);
        if (!state.focus)
            return;
        const field = root.querySelector(`[data-tra-field="${state.focus.field}"]`);
        if (!(field instanceof HTMLElement))
            return;
        field.focus({ preventScroll: true });
        if (state.focus.start !== null && typeof field.setSelectionRange === "function") {
            try {
                field.setSelectionRange(state.focus.start, state.focus.end ?? state.focus.start);
            }
            catch {
                // Ignore inputs without text selection support.
            }
        }
    }
    render() {
        const root = this.contentEl;
        // Keep the tag catalog at its current scroll position when selecting a tag
        // causes the whole view to be rebuilt.
        const previousTagList = root.querySelector(".tra-tag-list");
        const previousTagListScrollTop = previousTagList?.scrollTop ?? this.tagListScrollTop ?? 0;
        this.tagListScrollTop = previousTagListScrollTop;
        const uiState = this.captureUiState(root);
        this.disposeRenderResources();
        this.renderGeneration += 1;
        this.renderComponent = this.addChild(new Component());
        root.empty();
        root.addClass("tra-view");
        // Touch layout on phones and tablets (larger hit areas, full-screen windows).
        root.classList.toggle("is-tra-mobile", Boolean(Platform?.isMobile));
        const shell = root.createDiv({ cls: "tra-shell" });

        const header = shell.createDiv({ cls: "tra-header" });
        const titleGroup = header.createDiv({ cls: "tra-title-group" });
        const iconWrap = titleGroup.createDiv({ cls: "tra-title-icon" });
        setIcon(iconWrap, "tags");
        const heading = titleGroup.createDiv({ cls: "tra-heading" });
        heading.createEl("h2", { text: "Tag Refactor" });
        heading.createEl("p", { text: "Аудит, рефакторинг и массовое управление тегами" });
        const scanButton = header.createEl("button", { cls: "tra-icon-button", attr: { "aria-label": "Сканировать теги", title: "Сканировать теги" } });
        setIcon(scanButton, "refresh-cw");
        scanButton.addEventListener("click", () => {
            void this.plugin.scanTags({ force: true }).then(() => new Notice("Сканирование тегов завершено."));
        });

        const overview = shell.createDiv({ cls: "tra-overview" });
        this.createStat(overview, "Теги", String(this.plugin.tagIndex.size), "hash");
        this.createStat(overview, "Заметки", String(this.plugin.app.vault.getMarkdownFiles().length), "files");
        this.createStat(overview, "В очереди", String(this.plugin.getPendingChanges().length), "git-pull-request");

        const pageTabs = shell.createDiv({ cls: "tra-page-tabs", attr: { role: "tablist", "aria-label": "Разделы Tag Refactor" } });
        const auditTab = pageTabs.createEl("button", {
            cls: `tra-page-tab${this.activePage === "audit" ? " is-active" : ""}`,
            attr: { type: "button", role: "tab", "aria-selected": String(this.activePage === "audit") },
        });
        setIcon(auditTab.createSpan({ cls: "tra-page-tab-icon" }), "tags");
        auditTab.createSpan({ text: "Аудит тегов" });
        auditTab.addEventListener("click", () => {
            if (this.activePage !== "audit") {
                this.activePage = "audit";
                this.render();
            }
        });
        const bulkTab = pageTabs.createEl("button", {
            cls: `tra-page-tab${this.activePage === "bulk" ? " is-active" : ""}`,
            attr: { type: "button", role: "tab", "aria-selected": String(this.activePage === "bulk") },
        });
        setIcon(bulkTab.createSpan({ cls: "tra-page-tab-icon" }), "list-checks");
        bulkTab.createSpan({ text: "Заметки по датам" });
        bulkTab.addEventListener("click", () => {
            if (this.activePage !== "bulk") {
                this.activePage = "bulk";
                this.render();
            }
        });

        if (this.activePage === "bulk")
            this.renderBulkManagement(shell);
        else
            this.renderAuditPage(shell, previousTagListScrollTop);
        this.renderFooter(shell);
        this.restoreUiState(root, uiState);
    }
    renderFooter(shell) {
        const footer = shell.createDiv({ cls: "tra-footer" });
        footer.createSpan({ text: this.plugin.lastScanTime ? `Синхронизировано · ${relativeTime(this.plugin.lastScanTime)}` : "Ожидание индекса" });
        const settingsButton = footer.createEl("button", { cls: "tra-text-button", text: "Настройки" });
        settingsButton.addEventListener("click", () => {
            // Obsidian exposes settings navigation at runtime.
            this.plugin.app.setting?.open();
            this.plugin.app.setting?.openTabById?.(this.plugin.manifest.id);
        });
    }
    getTagsForFile(file) {
        // Precomputed per scan; already in catalog (collator) order.
        return this.plugin.getTagsForFile(file);
    }
    createStat(parent, label, value, iconName) {
        const stat = parent.createDiv({ cls: "tra-stat" });
        const icon = stat.createDiv({ cls: "tra-stat-icon" });
        setIcon(icon, iconName);
        stat.createDiv({ cls: "tra-stat-label", text: label });
        stat.createDiv({ cls: "tra-stat-value", text: value });
    }
    getNoteCreationTimestamp(file) {
        return this.plugin.getNoteCreationTimestamp(file);
    }
}
applyMixins(TagAuditorView, AuditPageMixin, BulkPageMixin);

module.exports = { TagAuditorView };
