"use strict";
/** Подтверждение применения очереди с выбором заметок, в которые вносятся изменения. */
const { Modal, Notice, setIcon } = require("obsidian");
const { tagKey } = require("../tags/tag-name.js");
const { pluralRu } = require("../utils.js");
const { FileReviewList } = require("./file-review-list.js");

class ApplyConfirmModal extends Modal {
    /**
     * @param files заметки, затронутые очередью; по умолчанию выбраны все.
     * @param onConfirm получает Set путей выбранных заметок.
     */
    constructor(app, plugin, changes, files, mergedTargets, onConfirm) {
        super(app);
        this.plugin = plugin;
        this.changes = changes;
        this.files = files;
        this.mergedTargets = mergedTargets;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        this.modalEl?.addClass?.("tra-apply-modal");
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        setIcon(icon, "shield-check");
        contentEl.createEl("h2", { text: "Применить изменения?" });
        const renameCount = this.changes.filter((change) => change.action === "rename").length;
        const deleteCount = this.changes.filter((change) => change.action === "delete" || (change.newTag === null && change.action !== "add")).length;
        const unmarkCount = this.changes.filter((change) => change.action === "unmark").length;
        const addCount = this.changes.filter((change) => change.action === "add").length;
        const actionSummary = [
            renameCount ? `${renameCount} ${pluralRu(renameCount, "переименование", "переименования", "переименований")}` : "",
            deleteCount ? `${deleteCount} ${pluralRu(deleteCount, "удаление тега", "удаления тега", "удалений тегов")}` : "",
            unmarkCount ? `${unmarkCount} ${pluralRu(unmarkCount, "снятие маркировки", "снятия маркировки", "снятий маркировки")}` : "",
            addCount ? `${addCount} ${pluralRu(addCount, "пакет добавления тегов", "пакета добавления тегов", "пакетов добавления тегов")}` : "",
        ].filter(Boolean).join(", ");
        const total = this.files.length;
        contentEl.createEl("p", { text: `Затронуто ${total} ${pluralRu(total, "заметка", "заметки", "заметок")}. ${actionSummary ? `В очереди: ${actionSummary}.` : ""}` });
        const changes = contentEl.createDiv({ cls: "tra-modal-changes" });
        for (const change of this.changes) {
            const row = changes.createDiv({ cls: "tra-modal-change" });
            row.createSpan({ text: `#${change.oldTag}` });
            if (change.action === "add") {
                const add = row.createSpan({ cls: "tra-modal-add" });
                setIcon(add, "plus");
                row.createSpan({ text: `Добавить ${change.addTags.map((tag) => `#${tag}`).join(" ")}` });
            }
            else if (change.action === "delete" || change.newTag === null) {
                const remove = row.createSpan({ cls: "tra-modal-delete" });
                setIcon(remove, "trash-2");
                row.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmark = row.createSpan({ cls: "tra-modal-unmark" });
                setIcon(unmark, "hash");
                row.createSpan({ text: "Оставить # как обычный текст" });
            }
            else {
                const arrow = row.createSpan({ cls: "tra-modal-arrow" });
                setIcon(arrow, "arrow-right");
                row.createSpan({ text: `#${change.newTag}` });
            }
        }
        if (this.mergedTargets.length > 0) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            const warningIcon = warning.createDiv();
            setIcon(warningIcon, "alert-triangle");
            const warningText = warning.createDiv();
            warningText.createEl("strong", { text: "Возможное объединение тегов" });
            warningText.createEl("p", { text: `Следующие целевые теги уже существуют или повторяются в очереди: ${this.mergedTargets.map((tag) => `#${tag}`).join(", ")}. Это объединит их статистику.` });
        }
        const caseSensitive = this.plugin.settings.caseSensitive;
        const sourceKeys = new Set(this.changes.map((change) => tagKey(change.oldTag, caseSensitive)));
        const transform = this.plugin.buildQueueTransform(this.changes);
        this.review = new FileReviewList(this.app, this.plugin, {
            files: this.files,
            preview: (file) => this.plugin.previewTransform(file, transform),
            chipTags: (file) => this.plugin.getTagsForFile(file).filter((tag) => sourceKeys.has(tagKey(tag, caseSensitive))),
            highlightTag: this.changes.length === 1 ? this.changes[0].oldTag : undefined,
            onChange: () => this.syncConfirm(),
        });
        this.review.render(contentEl);
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена", attr: { type: "button" } });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button tra-apply-confirm", attr: { type: "button" } });
        this.confirmButton = confirm;
        confirm.addEventListener("click", async () => {
            if (this.review.selectedPaths.size === 0)
                return;
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.onConfirm(new Set(this.review.selectedPaths));
                this.close();
            }
            catch (error) {
                new Notice(`Не удалось применить изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
        this.syncConfirm();
    }
    syncConfirm() {
        const confirm = this.confirmButton;
        if (!confirm || !this.review || confirm.textContent === "Обработка…")
            return;
        const selected = this.review.selectedPaths.size;
        const total = this.files.length;
        confirm.disabled = selected === 0;
        confirm.setText(selected === total
            ? "Применить ко всем"
            : `Применить к ${selected} ${pluralRu(selected, "заметке", "заметкам", "заметкам")}`);
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = { ApplyConfirmModal };
