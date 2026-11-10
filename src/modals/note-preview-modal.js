"use strict";
/** Просмотр заметки в окне по центру экрана с затемнением фона. */
const { Component, MarkdownRenderer, Modal, setIcon } = require("obsidian");
const { extractNoteTags } = require("../tags/extract.js");
const { containsActiveMarkdownTag } = require("../tags/markdown.js");
const { listPosts } = require("../tags/posts.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { tagKey } = require("../tags/tag-name.js");
const { highlightTagInElement } = require("../utils.js");

class NotePreviewModal extends Modal {
    /**
     * @param options.plugin     плагин (теги заметки, дата, регистр)
     * @param options.highlightTag тег, который подсвечивается и к которому прокручивается окно
     * @param options.selection  { isSelected(): boolean, toggle(): void } — если задан,
     *                           в окне есть переключатель «Изменять эту заметку»
     * @param options.posts      { get(): {indices, count} | null, set(value | null): void } — если задан
     *                           и в заметке несколько записей (разделитель ---), их можно выбрать по отдельности
     * @param options.navigation { files: TFile[], optionsFor(file): object } — список для кнопок
     *                           «Назад / Вперёд»; optionsFor даёт selection/posts/highlightTag для заметки
     */
    constructor(app, file, options = {}) {
        super(app);
        this.file = file;
        this.baseOptions = options;
        this.options = options;
        this.navigation = options.navigation?.files?.length > 1 ? options.navigation : null;
        this.component = null;
        this.keyHandler = null;
    }
    onOpen() {
        this.modalEl?.addClass?.("tra-note-modal");
        this.contentEl.addClass("tra-modal", "tra-note-preview");
        if (this.navigation) {
            // ← / → switch notes, except while typing in a field.
            this.keyHandler = (event) => {
                const target = event.target;
                if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && target.getAttribute("type") !== "checkbox"))
                    return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    this.go(event.key === "ArrowLeft" ? -1 : 1);
                }
            };
            document.addEventListener("keydown", this.keyHandler, true);
        }
        this.renderNote();
    }
    currentIndex() {
        return this.navigation ? this.navigation.files.findIndex((candidate) => candidate.path === this.file.path) : -1;
    }
    /** Show the previous (-1) or next (+1) note of the navigation list. */
    go(delta) {
        if (!this.navigation)
            return;
        const files = this.navigation.files;
        const next = this.currentIndex() + delta;
        if (next < 0 || next >= files.length)
            return;
        this.file = files[next];
        this.options = { ...this.baseOptions, ...(this.navigation.optionsFor?.(this.file) ?? {}) };
        this.renderNote();
    }
    renderNote() {
        const { contentEl, file } = this;
        const plugin = this.options.plugin;
        this.component?.unload();
        this.component = null;
        this.postState = null;
        this.noteCheckbox = null;
        this.postCountEl = null;
        contentEl.empty();
        if (this.navigation)
            this.renderNavigation(contentEl);

        const header = contentEl.createDiv({ cls: "tra-note-header" });
        const titleWrap = header.createDiv({ cls: "tra-note-title-wrap" });
        titleWrap.createEl("h2", { cls: "tra-note-title", text: file.basename });
        titleWrap.createDiv({ cls: "tra-note-path", text: file.path });
        const meta = titleWrap.createDiv({ cls: "tra-note-meta" });
        if (plugin) {
            const created = plugin.getNoteCreationTimestamp(file);
            meta.createSpan({ cls: "tra-note-date", text: created ? `${new Date(created).toLocaleDateString()} · ${plugin.describeDateSource()}` : `Нет даты (${plugin.describeDateSource()})` });
        }
        // Filled from the note's own text in renderBody(), so every tag is shown
        // even for ignored folders or a stale index.
        this.tagsEl = titleWrap.createDiv({ cls: "tra-note-tags" });
        this.tagsEl.createSpan({ cls: "tra-note-tags-label", text: "Теги: загрузка…" });
        const actions = header.createDiv({ cls: "tra-note-actions" });
        const selection = this.options.selection;
        if (selection) {
            const label = actions.createEl("label", { cls: "tra-note-select" });
            const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
            checkbox.checked = selection.isSelected();
            label.createSpan({ text: "Изменять эту заметку" });
            this.noteCheckbox = checkbox;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== selection.isSelected())
                    selection.toggle();
                checkbox.checked = selection.isSelected();
                // Re-selecting the whole note starts again with all of its records.
                this.options.posts?.set(null);
                this.syncPosts();
            });
        }
        const openButton = actions.createEl("button", { cls: "tra-secondary-button", attr: { type: "button", title: "Открыть заметку в новой вкладке" } });
        setIcon(openButton.createSpan({ cls: "tra-button-icon" }), "external-link");
        openButton.createSpan({ text: "Открыть во вкладке" });
        openButton.addEventListener("click", () => {
            this.close();
            void this.app.workspace.getLeaf("tab").openFile(file);
        });

        const body = contentEl.createDiv({ cls: "tra-note-body markdown-rendered", text: "Загрузка…" });
        // Internal links inside the preview open the linked note in a new tab.
        body.addEventListener("click", (event) => {
            const link = event.target instanceof Element ? event.target.closest("a.internal-link") : null;
            if (!link)
                return;
            event.preventDefault();
            const href = link.getAttribute("data-href") ?? link.getAttribute("href");
            if (href) {
                this.close();
                void this.app.workspace.openLinkText(href, file.path, "tab");
            }
        });
        this.component = new Component();
        this.component.load();
        void this.renderBody(body);
    }
    async renderBody(body) {
        // Captured now: after navigating to another note this.component is replaced.
        const component = this.component;
        try {
            const raw = await this.app.vault.cachedRead(this.file);
            if (!body.isConnected && !this.contentEl.contains(body))
                return;
            this.renderTags(raw);
            body.empty();
            const { posts, count } = listPosts(raw);
            if (this.options.posts && posts.filter((post) => !post.isEmpty).length > 1) {
                await this.renderPosts(body, posts, count);
                return;
            }
            const markdown = stripFrontmatter(raw).trim();
            if (!markdown) {
                body.createDiv({ cls: "tra-bulk-excerpt-empty", text: "Пустая заметка" });
                return;
            }
            await MarkdownRenderer.render(this.app, markdown, body, this.file.path, component);
            const tag = this.options.highlightTag;
            if (tag && this.options.plugin) {
                highlightTagInElement(body, tag, this.options.plugin.settings.caseSensitive);
                body.querySelector("mark.tra-highlight")?.scrollIntoView({ block: "center" });
            }
        }
        catch (error) {
            body.setText(`Не удалось прочитать заметку: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** Each record separately, with a checkbox: changes then touch only the checked records. */
    async renderPosts(body, posts, count) {
        const component = this.component;
        const control = this.options.posts;
        const meaningful = posts.filter((post) => !post.isEmpty).map((post) => post.index);
        this.postState = { control, meaningful, count };
        const bar = body.createDiv({ cls: "tra-post-bar" });
        this.postCountEl = bar.createSpan({ cls: "tra-post-count" });
        const all = bar.createEl("button", { cls: "tra-secondary-button tra-post-all", attr: { type: "button" }, text: "Все записи" });
        const none = bar.createEl("button", { cls: "tra-secondary-button tra-post-none", attr: { type: "button" }, text: "Снять все" });
        bar.createSpan({ cls: "tra-note-selection-hint", text: "Изменения затронут только отмеченные записи. Шапка записи — выбрать." });
        all.addEventListener("click", () => this.updatePosts(new Set(meaningful)));
        none.addEventListener("click", () => this.updatePosts(new Set()));
        const caseSensitive = this.options.plugin?.settings.caseSensitive ?? false;
        const tag = this.options.highlightTag;
        let number = 0;
        for (const post of posts) {
            if (post.isEmpty)
                continue;
            number += 1;
            const block = body.createDiv({ cls: "tra-post", attr: { "data-index": String(post.index) } });
            const head = block.createDiv({ cls: "tra-post-head", attr: { title: "Выбрать или снять выбор записи" } });
            const checkbox = head.createEl("input", { cls: "tra-post-check", attr: { type: "checkbox", "aria-label": `Изменять запись ${number}` } });
            head.createSpan({ cls: "tra-post-title", text: `Запись ${number} из ${meaningful.length}` });
            if (tag && containsActiveMarkdownTag(post.text, tag, caseSensitive))
                head.createSpan({ cls: "tra-post-tag", text: `#${tag}` });
            head.addEventListener("click", (event) => {
                if (event.target === checkbox)
                    return;
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            });
            checkbox.addEventListener("change", () => {
                const current = this.currentPosts();
                if (checkbox.checked)
                    current.add(post.index);
                else
                    current.delete(post.index);
                this.updatePosts(current);
            });
            const content = block.createDiv({ cls: "tra-post-content markdown-rendered" });
            await MarkdownRenderer.render(this.app, post.text.trim(), content, this.file.path, component);
            if (tag)
                highlightTagInElement(content, tag, caseSensitive);
        }
        this.syncPosts();
        body.querySelector("mark.tra-highlight")?.scrollIntoView({ block: "center" });
    }
    currentPosts() {
        const { control, meaningful, count } = this.postState;
        const selection = control.get();
        if (!this.options.selection?.isSelected?.() && this.options.selection)
            return new Set();
        return selection && selection.count === count ? new Set(selection.indices) : new Set(meaningful);
    }
    updatePosts(indices) {
        const { control, meaningful, count } = this.postState;
        const selection = this.options.selection;
        if (indices.size === 0) {
            control.set(null);
            if (selection?.isSelected())
                selection.toggle();
        }
        else {
            control.set(indices.size === meaningful.length ? null : { indices: [...indices].sort((a, b) => a - b), count, meaningful: meaningful.length });
            if (selection && !selection.isSelected())
                selection.toggle();
        }
        if (this.noteCheckbox && selection)
            this.noteCheckbox.checked = selection.isSelected();
        this.syncPosts();
    }
    syncPosts() {
        if (!this.postState)
            return;
        const current = this.currentPosts();
        const total = this.postState.meaningful.length;
        this.postCountEl?.setText(`Записи: выбрано ${current.size} из ${total}`);
        for (const block of Array.from(this.contentEl.querySelectorAll(".tra-post"))) {
            const index = Number(block.getAttribute("data-index"));
            const checked = current.has(index);
            block.classList.toggle("is-excluded", !checked);
            const checkbox = block.querySelector(".tra-post-check");
            if (checkbox)
                checkbox.checked = checked;
        }
        const all = this.contentEl.querySelector(".tra-post-all");
        if (all)
            all.disabled = current.size === total;
        const none = this.contentEl.querySelector(".tra-post-none");
        if (none)
            none.disabled = current.size === 0;
    }
    renderTags(raw) {
        const el = this.tagsEl;
        if (!el)
            return;
        el.empty();
        const plugin = this.options.plugin;
        const caseSensitive = plugin?.settings.caseSensitive ?? false;
        const { yaml, inline, all } = extractNoteTags(raw, caseSensitive);
        // Tags known to the metadata cache but not found in the text (unusual
        // syntax) are still listed, so nothing the vault counts is hidden.
        const cache = this.app.metadataCache.getFileCache(this.file);
        const seen = new Set(all.map((tag) => tagKey(tag, caseSensitive)));
        for (const cached of cache?.tags ?? []) {
            const tag = cached.tag.replace(/^#/, "");
            const key = tagKey(tag, caseSensitive);
            if (tag && !seen.has(key)) {
                seen.add(key);
                all.push(tag);
                inline.push(tag);
            }
        }
        el.createSpan({ cls: "tra-note-tags-label", text: all.length ? `Теги (${all.length}):` : "Тегов нет" });
        const yamlKeys = new Set(yaml.map((tag) => tagKey(tag, caseSensitive)));
        const inlineKeys = new Set(inline.map((tag) => tagKey(tag, caseSensitive)));
        const highlightKey = this.options.highlightTag ? tagKey(this.options.highlightTag, caseSensitive) : null;
        for (const tag of all) {
            const key = tagKey(tag, caseSensitive);
            const inYaml = yamlKeys.has(key);
            const inText = inlineKeys.has(key);
            const chip = el.createSpan({
                cls: `tra-note-tag${key === highlightKey ? " is-current" : ""}${inYaml ? " is-yaml" : ""}`,
                attr: { title: inYaml && inText ? "В свойствах YAML и в тексте" : inYaml ? "В свойствах YAML" : "В тексте заметки" },
            });
            chip.createSpan({ cls: "tra-note-tag-name", text: `#${tag}` });
            if (inYaml)
                chip.createSpan({ cls: "tra-note-tag-source", text: inText ? "YAML + текст" : "YAML" });
        }
    }
    renderNavigation(parent) {
        const files = this.navigation.files;
        const index = this.currentIndex();
        const nav = parent.createDiv({ cls: "tra-note-nav" });
        const prev = nav.createEl("button", { cls: "tra-secondary-button tra-note-prev", attr: { type: "button", title: "Предыдущая заметка (←)", "aria-label": "Предыдущая заметка" } });
        setIcon(prev.createSpan({ cls: "tra-button-icon" }), "chevron-left");
        prev.createSpan({ text: "Назад" });
        nav.createSpan({ cls: "tra-note-position", text: `${index + 1} из ${files.length}` });
        const next = nav.createEl("button", { cls: "tra-secondary-button tra-note-next", attr: { type: "button", title: "Следующая заметка (→)", "aria-label": "Следующая заметка" } });
        next.createSpan({ text: "Вперёд" });
        setIcon(next.createSpan({ cls: "tra-button-icon" }), "chevron-right");
        prev.disabled = index <= 0;
        next.disabled = index < 0 || index >= files.length - 1;
        prev.addEventListener("click", () => this.go(-1));
        next.addEventListener("click", () => this.go(1));
    }
    onClose() {
        if (this.keyHandler) {
            document.removeEventListener("keydown", this.keyHandler, true);
            this.keyHandler = null;
        }
        this.component?.unload();
        this.component = null;
        this.contentEl.empty();
    }
}

module.exports = { NotePreviewModal };
