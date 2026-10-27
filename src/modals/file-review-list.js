"use strict";
/**
 * Список заметок в окнах подтверждения: галочки, фильтр, «Выбрать все / Снять все»,
 * просмотр заметки и построчный предпросмотр изменений «было → стало».
 */
const { setIcon } = require("obsidian");
const { FILE_SELECT_PAGE_SIZE } = require("../constants.js");
const { buildHunks, diffLines, inlineChange } = require("../diff.js");
const { pluralRu } = require("../utils.js");
const { NotePreviewModal } = require("./note-preview-modal.js");

const MAX_HUNKS = 20;

/** Render a before/after diff of one note into `container`. Returns { added, removed }. */
function renderDiff(container, before, after) {
    container.empty();
    const ops = diffLines(before, after);
    const hunks = buildHunks(ops, 2);
    const added = ops.filter((op) => op.type === "add").length;
    const removed = ops.filter((op) => op.type === "del").length;
    if (hunks.length === 0) {
        container.createDiv({ cls: "tra-diff-empty", text: "Заметка не изменится." });
        return { added, removed };
    }
    for (const hunk of hunks.slice(0, MAX_HUNKS)) {
        const hunkEl = container.createDiv({ cls: "tra-diff-hunk" });
        const list = hunk.ops;
        for (let i = 0; i < list.length; i += 1) {
            const op = list[i];
            if (op.type === "del") {
                // Pair a run of removed lines with the following run of added lines
                // to highlight what changed inside each line.
                let delEnd = i;
                while (delEnd < list.length && list[delEnd].type === "del")
                    delEnd += 1;
                let addEnd = delEnd;
                while (addEnd < list.length && list[addEnd].type === "add")
                    addEnd += 1;
                const dels = list.slice(i, delEnd);
                const adds = list.slice(delEnd, addEnd);
                const paired = dels.length === adds.length;
                dels.forEach((del, k) => renderLine(hunkEl, del, paired ? inlineChange(del.text, adds[k].text).before : null));
                adds.forEach((add, k) => renderLine(hunkEl, add, paired ? inlineChange(dels[k].text, add.text).after : null));
                i = addEnd - 1;
                continue;
            }
            renderLine(hunkEl, op, null);
        }
    }
    if (hunks.length > MAX_HUNKS)
        container.createDiv({ cls: "tra-diff-more", text: `…и ещё ${hunks.length - MAX_HUNKS} ${pluralRu(hunks.length - MAX_HUNKS, "фрагмент", "фрагмента", "фрагментов")} изменений` });
    return { added, removed };
}
function renderLine(parent, op, parts) {
    const cls = op.type === "add" ? "is-add" : op.type === "del" ? "is-del" : "is-context";
    const line = parent.createDiv({ cls: `tra-diff-line ${cls}` });
    line.createSpan({ cls: "tra-diff-num", text: String((op.type === "add" ? op.lineB : op.lineA) ?? "") });
    line.createSpan({ cls: "tra-diff-sign", text: op.type === "add" ? "+" : op.type === "del" ? "−" : " " });
    const text = line.createSpan({ cls: "tra-diff-text" });
    if (parts && parts[1]) {
        text.appendText(parts[0]);
        text.createEl("mark", { cls: "tra-diff-change", text: parts[1] });
        text.appendText(parts[2]);
    }
    else {
        text.setText(op.text === "" ? " " : op.text);
    }
}

class FileReviewList {
    /**
     * @param options.files       заметки; по умолчанию выбраны все
     * @param options.preview     async (file) => { before, after } — без записи на диск
     * @param options.chipTags    (file) => string[] — теги, показываемые у заметки
     * @param options.highlightTag тег для подсветки в окне просмотра
     * @param options.onChange    () => void — при изменении выбора
     */
    constructor(app, plugin, options) {
        this.app = app;
        this.plugin = plugin;
        this.options = options;
        this.files = options.files;
        this.selectedPaths = new Set(this.files.map((file) => file.path));
        this.filter = "";
        this.renderLimit = FILE_SELECT_PAGE_SIZE;
        this.openDiffs = new Set();
        this.diffStats = new Map();
    }
    render(parent) {
        const section = parent.createDiv({ cls: "tra-apply-files" });
        const header = section.createDiv({ cls: "tra-apply-files-header" });
        header.createEl("strong", { text: "Заметки для изменения" });
        this.countEl = header.createSpan({ cls: "tra-apply-files-count" });
        const toolbar = section.createDiv({ cls: "tra-apply-files-toolbar" });
        const filterInput = toolbar.createEl("input", {
            cls: "tra-apply-files-filter",
            attr: { type: "text", placeholder: "Фильтр по названию или пути…", "aria-label": "Фильтр заметок", spellcheck: "false" },
        });
        this.selectAllButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-select-all", attr: { type: "button" } });
        this.selectNoneButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-select-none", attr: { type: "button" } });
        this.diffAllButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-diff-all", attr: { type: "button" } });
        this.listEl = section.createDiv({ cls: "tra-apply-files-list" });
        filterInput.addEventListener("input", () => {
            this.filter = filterInput.value.trim().toLocaleLowerCase();
            this.renderLimit = FILE_SELECT_PAGE_SIZE;
            this.renderRows();
        });
        // «Выбрать все» / «Снять все» действуют на заметки, видимые с учётом фильтра.
        this.selectAllButton.addEventListener("click", () => {
            for (const file of this.visibleFiles())
                this.selectedPaths.add(file.path);
            this.sync();
        });
        this.selectNoneButton.addEventListener("click", () => {
            for (const file of this.visibleFiles())
                this.selectedPaths.delete(file.path);
            this.sync();
        });
        this.diffAllButton.addEventListener("click", () => {
            const rows = Array.from(this.listEl.querySelectorAll(".tra-apply-file"));
            const open = rows.length > 0 && rows.every((row) => this.openDiffs.has(row.getAttribute("data-path")));
            for (const row of rows)
                this.setDiffOpen(row, !open);
            this.sync();
        });
        this.renderRows();
    }
    visibleFiles() {
        if (!this.filter)
            return this.files;
        return this.files.filter((file) => file.path.toLocaleLowerCase().includes(this.filter));
    }
    renderRows() {
        this.listEl.empty();
        const files = this.visibleFiles();
        if (files.length === 0)
            this.listEl.createDiv({ cls: "tra-apply-files-empty", text: "Нет заметок, подходящих под фильтр." });
        else
            this.appendRows(files, 0, Math.min(files.length, this.renderLimit));
        this.sync();
    }
    appendRows(files, from, to) {
        for (const file of files.slice(from, to)) {
            const wrapper = this.listEl.createDiv({ cls: "tra-apply-file", attr: { "data-path": file.path } });
            const row = wrapper.createDiv({ cls: "tra-apply-file-row", attr: { title: "Выбрать или снять выбор" } });
            const checkbox = row.createEl("input", { attr: { type: "checkbox", "aria-label": `Изменять ${file.basename}` } });
            checkbox.checked = this.selectedPaths.has(file.path);
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => this.setSelected(file.path, checkbox.checked));
            row.addEventListener("click", (event) => {
                if (event.target instanceof Element && event.target.closest("button"))
                    return;
                this.setSelected(file.path, !this.selectedPaths.has(file.path));
            });
            const text = row.createDiv({ cls: "tra-apply-file-text" });
            text.createDiv({ cls: "tra-apply-file-name", text: file.basename });
            text.createDiv({ cls: "tra-apply-file-path", text: file.path });
            const tags = row.createDiv({ cls: "tra-apply-file-tags" });
            for (const tag of this.options.chipTags?.(file) ?? [])
                tags.createSpan({ cls: "tra-bulk-tag-chip", text: `#${tag}` });
            row.createSpan({ cls: "tra-apply-file-stat" });
            const diffButton = row.createEl("button", { cls: "tra-apply-file-diff", attr: { type: "button", title: "Показать изменения", "aria-label": `Изменения в ${file.basename}` } });
            setIcon(diffButton, "file-diff");
            diffButton.addEventListener("click", () => {
                this.setDiffOpen(wrapper, !this.openDiffs.has(file.path));
                this.sync();
            });
            const open = row.createEl("button", { cls: "tra-apply-file-open", attr: { type: "button", title: "Просмотреть заметку", "aria-label": `Просмотреть ${file.basename}` } });
            setIcon(open, "eye");
            open.addEventListener("click", () => {
                new NotePreviewModal(this.app, file, {
                    plugin: this.plugin,
                    highlightTag: this.options.highlightTag,
                    selection: {
                        isSelected: () => this.selectedPaths.has(file.path),
                        toggle: () => this.setSelected(file.path, !this.selectedPaths.has(file.path)),
                    },
                }).open();
            });
            wrapper.createDiv({ cls: "tra-review-diff" });
            if (this.openDiffs.has(file.path))
                this.setDiffOpen(wrapper, true);
            this.updateStat(wrapper);
        }
        if (to < files.length) {
            const more = this.listEl.createEl("button", {
                cls: "tra-show-more",
                text: `Показать ещё ${Math.min(FILE_SELECT_PAGE_SIZE, files.length - to)} из ${files.length - to}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                more.remove();
                this.renderLimit = Math.min(files.length, to + FILE_SELECT_PAGE_SIZE);
                this.appendRows(files, to, this.renderLimit);
                this.sync();
            });
        }
    }
    setSelected(path, selected) {
        if (selected)
            this.selectedPaths.add(path);
        else
            this.selectedPaths.delete(path);
        this.sync();
    }
    setDiffOpen(wrapper, open) {
        const path = wrapper.getAttribute("data-path");
        const panel = wrapper.querySelector(".tra-review-diff");
        if (!panel)
            return;
        wrapper.classList.toggle("is-diff-open", open);
        if (!open) {
            this.openDiffs.delete(path);
            panel.empty();
            return;
        }
        this.openDiffs.add(path);
        const file = this.files.find((candidate) => candidate.path === path);
        panel.empty();
        panel.createDiv({ cls: "tra-diff-empty", text: "Вычисляю изменения…" });
        void this.options.preview(file).then(({ before, after }) => {
            if (!this.openDiffs.has(path) || !panel.isConnected && !wrapper.parentElement)
                return;
            this.diffStats.set(path, renderDiff(panel, before, after));
            this.updateStat(wrapper);
        }).catch((error) => {
            panel.empty();
            panel.createDiv({ cls: "tra-diff-error", text: `Не удалось подготовить изменения: ${error instanceof Error ? error.message : String(error)}` });
        });
    }
    updateStat(wrapper) {
        const stat = this.diffStats.get(wrapper.getAttribute("data-path"));
        const el = wrapper.querySelector(".tra-apply-file-stat");
        if (!el)
            return;
        el.empty();
        if (!stat)
            return;
        if (stat.added === 0 && stat.removed === 0) {
            el.setText("без изменений");
            return;
        }
        el.createSpan({ cls: "is-add", text: `+${stat.added}` });
        el.createSpan({ cls: "is-del", text: ` −${stat.removed}` });
    }
    sync() {
        const selected = this.selectedPaths.size;
        const total = this.files.length;
        this.countEl?.setText(`Выбрано ${selected} из ${total}`);
        const visible = this.visibleFiles();
        const visibleSelected = visible.filter((file) => this.selectedPaths.has(file.path)).length;
        const suffix = this.filter ? ` (${visible.length})` : "";
        if (this.selectAllButton) {
            this.selectAllButton.setText(`Выбрать все${suffix}`);
            this.selectAllButton.disabled = visibleSelected === visible.length;
        }
        if (this.selectNoneButton) {
            this.selectNoneButton.setText(`Снять все${suffix}`);
            this.selectNoneButton.disabled = visibleSelected === 0;
        }
        if (this.diffAllButton) {
            const rows = Array.from(this.listEl?.querySelectorAll(".tra-apply-file") ?? []);
            const allOpen = rows.length > 0 && rows.every((row) => this.openDiffs.has(row.getAttribute("data-path")));
            this.diffAllButton.setText(allOpen ? "Скрыть изменения" : "Показать изменения");
            this.diffAllButton.disabled = rows.length === 0;
        }
        for (const wrapper of Array.from(this.listEl?.querySelectorAll(".tra-apply-file") ?? [])) {
            const path = wrapper.getAttribute("data-path");
            const isSelected = this.selectedPaths.has(path);
            const input = wrapper.querySelector(".tra-apply-file-row input");
            if (input)
                input.checked = isSelected;
            wrapper.classList.toggle("is-selected", isSelected);
        }
        this.options.onChange?.();
    }
}

module.exports = { FileReviewList, renderDiff };
