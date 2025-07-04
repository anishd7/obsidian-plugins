import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

// View type constant
export const AI_CHAT_VIEW_TYPE = "ai-chat-view";

// AI Chat Plugin Settings
interface AIChatSettings {
	apiKey: string;
	organizationId: string;
	model: string;
}

const DEFAULT_SETTINGS: AIChatSettings = {
	apiKey: "",
	organizationId: "",
	model: "gpt-4o",
};

export default class AIChatPlugin extends Plugin {
	settings: AIChatSettings;

	async onload() {
		await this.loadSettings();

		// Register the view
		this.registerView(
			AI_CHAT_VIEW_TYPE,
			(leaf) => new AIChatView(leaf, this)
		);

		// Add AI chat button to ribbon
		const ribbonIconEl = this.addRibbonIcon(
			"message-circle",
			"AI Chat",
			(evt: MouseEvent) => {
				// Open AI chat view
				this.activateView();
			}
		);
		ribbonIconEl.addClass("ai-chat-ribbon-class");

		// Add command to open AI chat
		this.addCommand({
			id: "open-ai-chat",
			name: "Open AI Chat",
			callback: () => {
				this.activateView();
			},
		});

		// Add command to open AI chat in new tab
		this.addCommand({
			id: "open-ai-chat-tab",
			name: "Open AI Chat in new tab",
			callback: () => {
				this.activateView(true);
			},
		});

		// Add settings tab
		this.addSettingTab(new AIChatSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup if needed
	}

	async activateView(newTab = false) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE);

		if (leaves.length > 0 && !newTab) {
			// A chat view already exists, use it
			leaf = leaves[0];
		} else {
			// Create new leaf
			leaf = workspace.getLeaf(newTab ? "tab" : "split");
			await leaf.setViewState({
				type: AI_CHAT_VIEW_TYPE,
				active: true,
			});
		}

		// "Reveal" the leaf (switch to it)
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AIChatView extends ItemView {
	plugin: AIChatPlugin;
	chatContainer: HTMLElement;
	inputField: HTMLInputElement;
	sendButton: HTMLButtonElement;
	messages: Array<{ role: "user" | "assistant"; content: string }> = [];
	contextData = "";
	contextIndicator: HTMLElement;
	selectedFiles: string[] = [];
	suggestionPopup: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AIChatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return AI_CHAT_VIEW_TYPE;
	}

	getDisplayText() {
		return "AI Chat";
	}

	getIcon() {
		return "message-circle";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		// Create main container
		const mainContainer = container.createDiv("ai-chat-main-container");
		mainContainer.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			padding: 16px;
		`;

		// Create header
		const header = mainContainer.createDiv("ai-chat-header");
		header.style.cssText = `
			margin-bottom: 16px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--background-modifier-border);
			display: flex;
			justify-content: space-between;
			align-items: center;
		`;
		header.createEl("h3", { text: "AI Chat Assistant" });

		// Create context indicator
		this.contextIndicator = mainContainer.createDiv("context-indicator");
		this.contextIndicator.style.cssText = `
			display: none;
			padding: 8px 12px;
			background-color: var(--background-secondary);
			border: 1px solid var(--interactive-accent);
			border-radius: 4px;
			margin-bottom: 8px;
			font-size: 0.9em;
			color: var(--text-muted);
		`;
		this.updateContextIndicator();

		// Create chat container
		this.chatContainer = mainContainer.createDiv("ai-chat-container");
		this.chatContainer.style.cssText = `
			flex: 1;
			overflow-y: auto;
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 16px;
			margin-bottom: 16px;
			background-color: var(--background-secondary);
		`;

		// Create input container
		const inputContainer = mainContainer.createDiv(
			"ai-chat-input-container"
		);
		inputContainer.style.cssText = `
			display: flex;
			gap: 8px;
		`;

		// Create input field
		this.inputField = inputContainer.createEl("input", {
			type: "text",
			placeholder: "Type your message... (use @ to add notes)",
		});
		this.inputField.style.cssText = `
			flex: 1;
			padding: 8px 12px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			background-color: var(--background-primary);
			color: var(--text-normal);
		`;

		// Create send button
		this.sendButton = inputContainer.createEl("button", { text: "Send" });
		this.sendButton.style.cssText = `
			padding: 8px 16px;
			background-color: var(--interactive-accent);
			color: var(--text-on-accent);
			border: none;
			border-radius: 4px;
			cursor: pointer;
		`;

		// Create model selector container
		const modelContainer = mainContainer.createDiv(
			"ai-chat-model-container"
		);
		modelContainer.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 0;
			border-top: 1px solid var(--background-modifier-border);
			margin-top: 8px;
		`;

		// Model label
		const modelLabel = modelContainer.createEl("span", { text: "Model:" });
		modelLabel.style.cssText = `
			font-size: 0.9em;
			color: var(--text-muted);
		`;

		// Model selector dropdown
		const modelSelect = modelContainer.createEl("select");
		modelSelect.style.cssText = `
			padding: 4px 8px;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			background-color: var(--background-primary);
			color: var(--text-normal);
			font-size: 0.9em;
		`;

		// Add model options
		const modelOptions = [
			{ value: "gpt-4o", label: "GPT-4o" },
			{ value: "o3", label: "o3" },
		];

		modelOptions.forEach((option) => {
			const optionEl = modelSelect.createEl("option");
			optionEl.value = option.value;
			optionEl.textContent = option.label;
		});

		// Set current model
		modelSelect.value = this.plugin.settings.model;

		// Handle model change
		modelSelect.addEventListener("change", async (e) => {
			const target = e.target as HTMLSelectElement;
			this.plugin.settings.model = target.value;
			await this.plugin.saveSettings();
		});

		// Add event listeners
		this.sendButton.addEventListener("click", () => this.sendMessage());
		this.inputField.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				this.sendMessage();
			}
		});
		this.inputField.addEventListener("input", (e) => {
			this.handleInputChange(e as InputEvent);
		});
		this.inputField.addEventListener("keydown", (e) => {
			this.handleKeyDown(e);
		});

		// Show initial message
		this.addMessage(
			"assistant",
			"Hello! I'm your AI assistant. How can I help you today?"
		);

		// Focus input field
		this.inputField.focus();
	}

	async onClose() {
		// Cleanup when view is closed
		this.messages = [];
		this.contextData = "";
		this.selectedFiles = [];
		this.closeSuggestionPopup();
	}

	addMessage(role: "user" | "assistant", content: string) {
		const messageEl = this.chatContainer.createDiv("ai-chat-message");
		messageEl.style.cssText = `
			margin-bottom: 12px;
			padding: 8px 12px;
			border-radius: 8px;
			${
				role === "user"
					? "background-color: var(--interactive-accent); color: var(--text-on-accent); margin-left: 20%; text-align: right;"
					: "background-color: var(--background-modifier-hover); color: var(--text-normal); margin-right: 20%;"
			}
		`;

		const roleEl = messageEl.createEl("div", {
			text: role === "user" ? "You" : "AI",
		});
		roleEl.style.cssText = `
			font-size: 0.8em;
			opacity: 0.8;
			margin-bottom: 4px;
			font-weight: bold;
		`;

		// Create content container
		const contentEl = messageEl.createDiv("message-content");
		contentEl.style.cssText = `
			line-height: 1.5;
		`;

		if (role === "assistant") {
			// Render markdown for AI responses with proper formatting
			this.renderMarkdownContent(content, contentEl);
		} else {
			// Plain text for user messages
			contentEl.createEl("div", { text: content });
		}

		// Scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

		// Store message
		this.messages.push({ role, content });
	}

	async sendMessage() {
		const message = this.inputField.value.trim();
		if (!message) return;

		// Check if API key is configured
		if (!this.plugin.settings.apiKey) {
			this.addMessage(
				"assistant",
				"Please configure your OpenAI API key in the plugin settings first."
			);
			return;
		}

		// Clear input field
		this.inputField.value = "";

		// Add user message
		this.addMessage("user", message);

		// Show loading state
		this.sendButton.disabled = true;
		this.sendButton.textContent = "Thinking...";

		try {
			// Call real AI API
			await this.callOpenAI(message);
		} catch (error) {
			let errorMessage =
				"Sorry, I encountered an error. Please try again.";

			if (error instanceof Error) {
				if (error.message.includes("401")) {
					errorMessage =
						"Invalid API key. Please check your OpenAI API key in settings.";
				} else if (error.message.includes("429")) {
					errorMessage =
						"Rate limit exceeded. Please wait a moment and try again.";
				} else if (error.message.includes("network")) {
					errorMessage =
						"Network error. Please check your internet connection.";
				}
			}

			this.addMessage("assistant", errorMessage);
			console.error("AI Chat Error:", error);
		} finally {
			// Reset button state
			this.sendButton.disabled = false;
			this.sendButton.textContent = "Send";
			this.inputField.focus();
		}
	}

	async callOpenAI(userMessage: string) {
		// Prepare conversation history for context
		const conversationHistory = [
			{
				role: "system",
				content:
					"You are a helpful AI assistant integrated into Obsidian, a note-taking app. Be concise but thorough in your responses. Help users with their questions and tasks.",
			},
			// Include recent message history for context (last 10 messages)
			...this.messages.slice(-10),
		];

		// Add stored context if available
		if (this.contextData) {
			conversationHistory.push({
				role: "user",
				content: this.contextData,
			});
		}

		// Add the current user message
		conversationHistory.push({
			role: "user",
			content: userMessage,
		});

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.plugin.settings.apiKey}`,
		};

		// Add organization ID if provided
		if (this.plugin.settings.organizationId) {
			headers["OpenAI-Organization"] =
				this.plugin.settings.organizationId;
		}

		const response = await fetch(
			"https://api.openai.com/v1/chat/completions",
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					model: this.plugin.settings.model,
					messages: conversationHistory,
					max_tokens: 1000,
					temperature: 0.7,
					stream: false,
				}),
			}
		);

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(
				`OpenAI API error (${response.status}): ${
					errorData.error?.message || response.statusText
				}`
			);
		}

		const data = await response.json();
		const aiResponse =
			data.choices[0]?.message?.content ||
			"I apologize, but I received an empty response. Please try again.";

		this.addMessage("assistant", aiResponse);
	}

	handleInputChange(e: InputEvent) {
		const target = e.target as HTMLInputElement;
		const value = target.value;
		const cursorPos = target.selectionStart || 0;

		// Check if @ should trigger the menu (must be at word boundary)
		const shouldShowMenu = this.shouldShowFileMenu(value, cursorPos);

		if (shouldShowMenu) {
			this.showFileSuggestions(cursorPos);
		} else {
			this.closeSuggestionPopup();
		}
	}

	shouldShowFileMenu(text: string, cursorPos: number): boolean {
		// Find the @ symbol before the cursor
		const beforeCursor = text.substring(0, cursorPos);
		const atIndex = beforeCursor.lastIndexOf("@");

		// No @ found
		if (atIndex === -1) return false;

		// @ is not the last character before cursor
		if (atIndex !== cursorPos - 1) return false;

		// Check if @ is at word boundary (start of input or after whitespace)
		const charBeforeAt = atIndex > 0 ? text[atIndex - 1] : " ";
		const isAtWordBoundary = /\s/.test(charBeforeAt) || atIndex === 0;

		return isAtWordBoundary;
	}

	handleKeyDown(e: KeyboardEvent) {
		if (this.suggestionPopup) {
			if (e.key === "Escape") {
				this.closeSuggestionPopup();
				e.preventDefault();
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				// Handle arrow key navigation in future
				e.preventDefault();
			} else if (e.key === " ") {
				// Space after @ should close menu and treat as normal text
				this.closeSuggestionPopup();
			}
		}
	}

	async showFileSuggestions(cursorPos: number) {
		// Close existing popup first
		this.closeSuggestionPopup();

		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();

		if (files.length === 0) {
			new Notice("No notes found");
			return;
		}

		// Create suggestion popup
		this.suggestionPopup = this.containerEl.createDiv(
			"file-suggestion-popup"
		);
		this.suggestionPopup.style.cssText = `
			position: absolute;
			background-color: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
			z-index: 1000;
			max-height: 300px;
			min-width: 280px;
			max-width: 400px;
			overflow: hidden;
		`;

		// Position popup above input field
		const inputRect = this.inputField.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();
		this.suggestionPopup.style.left =
			inputRect.left - containerRect.left + "px";
		this.suggestionPopup.style.bottom =
			containerRect.bottom - inputRect.top + 8 + "px";

		// Add header
		const header = this.suggestionPopup.createDiv("suggestion-header");
		header.style.cssText = `
			padding: 12px 16px;
			border-bottom: 1px solid var(--background-modifier-border);
			font-weight: 600;
			font-size: 0.9em;
			color: var(--text-normal);
			background-color: var(--background-secondary);
			border-radius: 8px 8px 0 0;
		`;
		header.innerHTML = `
			<span style="margin-right: 8px;">📝</span>
			Add Notes to Context
			<span style="float: right; font-size: 0.8em; color: var(--text-muted);">
				${this.selectedFiles.length} selected
			</span>
		`;

		// Add scrollable file list
		const fileList = this.suggestionPopup.createDiv("file-list");
		fileList.style.cssText = `
			max-height: 240px;
			overflow-y: auto;
			padding: 4px 0;
		`;

		files.forEach((file) => {
			const fileItem = fileList.createDiv("file-item");
			const isSelected = this.selectedFiles.includes(file.path);

			fileItem.style.cssText = `
				padding: 8px 16px;
				cursor: pointer;
				display: flex;
				align-items: center;
				gap: 12px;
				transition: background-color 0.15s;
				border-radius: 4px;
				margin: 1px 4px;
				${
					isSelected
						? "background-color: var(--interactive-accent); color: var(--text-on-accent);"
						: ""
				}
			`;

			// Add checkbox
			const checkbox = fileItem.createDiv("checkbox");
			checkbox.style.cssText = `
				width: 16px;
				height: 16px;
				border: 2px solid ${
					isSelected
						? "var(--text-on-accent)"
						: "var(--background-modifier-border)"
				};
				border-radius: 3px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 10px;
				font-weight: bold;
				${
					isSelected
						? "background-color: var(--text-on-accent); color: var(--interactive-accent);"
						: "background-color: var(--background-primary);"
				}
			`;
			if (isSelected) {
				checkbox.textContent = "✓";
			}

			// Add file icon
			const fileIcon = fileItem.createSpan("file-icon");
			fileIcon.style.cssText = `
				opacity: 0.7;
				font-size: 14px;
			`;
			fileIcon.textContent = "📄";

			// Add file name
			const fileName = fileItem.createSpan("file-name");
			fileName.textContent = file.basename;
			fileName.style.cssText = `
				flex: 1;
				font-size: 0.9em;
				${isSelected ? "color: var(--text-on-accent);" : "color: var(--text-normal);"}
			`;

			// Add file path (if in subfolder)
			if (file.path.includes("/")) {
				const filePath = fileItem.createSpan("file-path");
				filePath.textContent = file.path.substring(
					0,
					file.path.lastIndexOf("/")
				);
				filePath.style.cssText = `
					font-size: 0.8em;
					opacity: 0.7;
					${isSelected ? "color: var(--text-on-accent);" : "color: var(--text-muted);"}
				`;
			}

			// Add hover effect
			fileItem.addEventListener("mouseenter", () => {
				if (!isSelected) {
					fileItem.style.backgroundColor =
						"var(--background-modifier-hover)";
				}
			});

			fileItem.addEventListener("mouseleave", () => {
				if (!isSelected) {
					fileItem.style.backgroundColor = "";
				}
			});

			// Handle click
			fileItem.addEventListener("click", (e) => {
				e.stopPropagation();
				this.toggleFileSelection(file.path);
				this.closeSuggestionPopup();
				// Remove the @ from input
				const currentValue = this.inputField.value;
				this.inputField.value = currentValue.slice(0, -1);
				this.inputField.focus();
			});
		});

		// Add footer with actions
		const footer = this.suggestionPopup.createDiv("suggestion-footer");
		footer.style.cssText = `
			padding: 8px 16px;
			border-top: 1px solid var(--background-modifier-border);
			display: flex;
			justify-content: space-between;
			align-items: center;
			background-color: var(--background-secondary);
			border-radius: 0 0 8px 8px;
		`;

		const doneBtn = footer.createEl("button", { text: "Done" });
		doneBtn.style.cssText = `
			padding: 4px 12px;
			background-color: var(--interactive-accent);
			color: var(--text-on-accent);
			border: none;
			border-radius: 4px;
			cursor: pointer;
			font-size: 0.8em;
			font-weight: 500;
		`;
		doneBtn.addEventListener("click", () => {
			this.closeSuggestionPopup();
			// Remove the @ from input
			const currentValue = this.inputField.value;
			this.inputField.value = currentValue.slice(0, -1);
			this.inputField.focus();
		});

		// Close popup when clicking outside
		const closePopup = (e: MouseEvent) => {
			if (
				!this.suggestionPopup?.contains(e.target as Node) &&
				e.target !== this.inputField
			) {
				this.closeSuggestionPopup();
				document.removeEventListener("click", closePopup);
			}
		};
		setTimeout(() => document.addEventListener("click", closePopup), 100);
	}

	closeSuggestionPopup() {
		if (this.suggestionPopup) {
			this.suggestionPopup.remove();
			this.suggestionPopup = null;
		}
	}

	async toggleFileSelection(filePath: string) {
		const index = this.selectedFiles.indexOf(filePath);
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (index === -1) {
			// Add file
			this.selectedFiles.push(filePath);
			new Notice(`Added ${file?.name} to context`);
		} else {
			// Remove file
			this.selectedFiles.splice(index, 1);
			new Notice(`Removed ${file?.name} from context`);
		}

		await this.updateContextFromFiles();
	}

	async updateContextFromFiles() {
		if (this.selectedFiles.length === 0) {
			this.contextData = "";
			this.updateContextIndicator();
			return;
		}

		let contextContent = "Here are the selected notes:\n\n";

		for (const filePath of this.selectedFiles) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				try {
					const content = await this.app.vault.read(file);
					contextContent += `## ${file.name.replace(
						".md",
						""
					)}\n\n${content}\n\n---\n\n`;
				} catch (error) {
					console.error(`Error reading file ${filePath}:`, error);
				}
			}
		}

		this.contextData = contextContent;
		this.updateContextIndicator();
	}

	async simulateAIResponse(userMessage: string) {
		// This method is no longer used, but keeping it for reference
		// Simulate AI thinking delay
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Simple echo response for now
		const response = `I received your message: "${userMessage}". This is a placeholder response. AI integration will be implemented next!`;
		this.addMessage("assistant", response);
	}

	updateContextIndicator() {
		if (this.contextData && this.selectedFiles.length > 0) {
			this.contextIndicator.style.display = "block";

			// Create description for selected files
			const fileNames = this.selectedFiles.map((filePath) => {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				return file ? file.name.replace(".md", "") : "Unknown";
			});

			const contextDescription =
				this.selectedFiles.length === 1
					? `📄 ${fileNames[0]}`
					: `📚 ${this.selectedFiles.length} notes (${fileNames
							.slice(0, 2)
							.join(", ")}${
							this.selectedFiles.length > 2 ? "..." : ""
					  })`;

			this.contextIndicator.innerHTML = `
				${contextDescription}
				<button class="clear-context-btn" style="
					margin-left: 8px;
					padding: 2px 6px;
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					border: none;
					border-radius: 3px;
					cursor: pointer;
					font-size: 0.8em;
				">Clear</button>
			`;

			// Add event listener for clear button
			const clearBtn =
				this.contextIndicator.querySelector(".clear-context-btn");
			if (clearBtn) {
				clearBtn.addEventListener("click", () => {
					this.selectedFiles = [];
					this.contextData = "";
					this.updateContextIndicator();
					new Notice("Context cleared");
				});
			}
		} else {
			this.contextIndicator.style.display = "none";
		}
	}

	renderMarkdownContent(content: string, container: HTMLElement) {
		// Make container selectable
		container.style.userSelect = "text";
		container.style.cursor = "text";

		const lines = content.split("\n");
		let inCodeBlock = false;
		let codeBlockContent = "";

		lines.forEach((line) => {
			// Handle code blocks
			if (line.startsWith("```")) {
				if (inCodeBlock) {
					// End code block
					const preEl = container.createEl("pre");
					preEl.style.cssText = `
						background-color: var(--background-secondary);
						padding: 12px;
						border-radius: 4px;
						overflow-x: auto;
						margin: 8px 0;
						user-select: text;
					`;
					const codeEl = preEl.createEl("code");
					codeEl.textContent = codeBlockContent;
					codeEl.style.userSelect = "text";
					inCodeBlock = false;
					codeBlockContent = "";
				} else {
					// Start code block
					inCodeBlock = true;
				}
				return;
			}

			if (inCodeBlock) {
				codeBlockContent += line + "\n";
				return;
			}

			if (line.trim()) {
				// Handle headers
				if (line.startsWith("### ")) {
					const h3 = container.createEl("h3");
					h3.textContent = line.substring(4);
					h3.style.userSelect = "text";
				} else if (line.startsWith("## ")) {
					const h2 = container.createEl("h2");
					h2.textContent = line.substring(3);
					h2.style.userSelect = "text";
				} else if (line.startsWith("# ")) {
					const h1 = container.createEl("h1");
					h1.textContent = line.substring(2);
					h1.style.userSelect = "text";
				} else if (line.startsWith("- ") || line.startsWith("* ")) {
					const ul =
						container.querySelector("ul:last-child") ||
						container.createEl("ul");
					const li = ul.createEl("li");
					this.parseInlineMarkdown(line.substring(2), li);
					(ul as HTMLElement).style.userSelect = "text";
				} else if (/^\d+\.\s/.test(line)) {
					const ol =
						container.querySelector("ol:last-child") ||
						container.createEl("ol");
					const li = ol.createEl("li");
					this.parseInlineMarkdown(line.replace(/^\d+\.\s/, ""), li);
					(ol as HTMLElement).style.userSelect = "text";
				} else {
					// Regular paragraph
					const p = container.createEl("p");
					p.style.cssText = `
						margin: 8px 0;
						user-select: text;
					`;
					this.parseInlineMarkdown(line, p);
				}
			} else {
				// Empty line
				container.createEl("br");
			}
		});
	}

	parseInlineMarkdown(text: string, element: HTMLElement) {
		element.style.userSelect = "text";

		// Handle bold, italic, and inline code
		const remaining = text;
		let currentPos = 0;

		while (currentPos < remaining.length) {
			// Find the next markdown marker
			const boldMatch = remaining.indexOf("**", currentPos);
			const italicMatch = remaining.indexOf("*", currentPos);
			const codeMatch = remaining.indexOf("`", currentPos);

			// Find the earliest marker
			let nextMarker = remaining.length;
			let markerType = "";

			if (boldMatch !== -1 && boldMatch < nextMarker) {
				nextMarker = boldMatch;
				markerType = "bold";
			}
			if (
				italicMatch !== -1 &&
				italicMatch < nextMarker &&
				italicMatch !== boldMatch
			) {
				nextMarker = italicMatch;
				markerType = "italic";
			}
			if (codeMatch !== -1 && codeMatch < nextMarker) {
				nextMarker = codeMatch;
				markerType = "code";
			}

			// Add text before the marker
			if (nextMarker > currentPos) {
				const textNode = document.createTextNode(
					remaining.substring(currentPos, nextMarker)
				);
				element.appendChild(textNode);
			}

			if (markerType === "") {
				break;
			}

			// Process the marker
			if (markerType === "bold") {
				const endPos = remaining.indexOf("**", nextMarker + 2);
				if (endPos !== -1) {
					const boldText = remaining.substring(
						nextMarker + 2,
						endPos
					);
					const boldEl = element.createEl("strong");
					boldEl.textContent = boldText;
					boldEl.style.userSelect = "text";
					currentPos = endPos + 2;
				} else {
					element.appendChild(document.createTextNode("**"));
					currentPos = nextMarker + 2;
				}
			} else if (markerType === "italic") {
				const endPos = remaining.indexOf("*", nextMarker + 1);
				if (endPos !== -1) {
					const italicText = remaining.substring(
						nextMarker + 1,
						endPos
					);
					const italicEl = element.createEl("em");
					italicEl.textContent = italicText;
					italicEl.style.userSelect = "text";
					currentPos = endPos + 1;
				} else {
					element.appendChild(document.createTextNode("*"));
					currentPos = nextMarker + 1;
				}
			} else if (markerType === "code") {
				const endPos = remaining.indexOf("`", nextMarker + 1);
				if (endPos !== -1) {
					const codeText = remaining.substring(
						nextMarker + 1,
						endPos
					);
					const codeEl = element.createEl("code");
					codeEl.textContent = codeText;
					codeEl.style.cssText = `
						background-color: var(--background-secondary);
						padding: 2px 4px;
						border-radius: 3px;
						font-family: var(--font-monospace);
						user-select: text;
					`;
					currentPos = endPos + 1;
				} else {
					element.appendChild(document.createTextNode("`"));
					currentPos = nextMarker + 1;
				}
			}
		}
	}
}

class AIChatSettingTab extends PluginSettingTab {
	plugin: AIChatPlugin;

	constructor(app: App, plugin: AIChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "AI Chat Settings" });

		// API Key setting
		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc(
				"Enter your OpenAI API key. You can get one from https://platform.openai.com/api-keys"
			)
			.addText((text) => {
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				// Make it a password field for security
				text.inputEl.type = "password";
				return text;
			});

		// Organization ID setting
		new Setting(containerEl)
			.setName("Organization ID (Optional)")
			.setDesc(
				"Enter your OpenAI organization ID if you're part of an organization. This may be required to avoid rate limiting."
			)
			.addText((text) => {
				text.setPlaceholder("org-...")
					.setValue(this.plugin.settings.organizationId)
					.onChange(async (value) => {
						this.plugin.settings.organizationId = value;
						await this.plugin.saveSettings();
					});
				return text;
			});

		// Model selection
		new Setting(containerEl)
			.setName("AI Model")
			.setDesc(
				"Select the AI model to use. You can also change this from within the chat pane."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("gpt-4o", "GPT-4o")
					.addOption("o3", "o3")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					})
			);

		// Instructions
		const instructionsEl = containerEl.createDiv();
		instructionsEl.style.cssText = `
			margin-top: 20px;
			padding: 12px;
			background-color: var(--background-secondary);
			border-radius: 8px;
			border-left: 4px solid var(--interactive-accent);
		`;
		instructionsEl.createEl("h4", { text: "Getting Started:" });
		const instructionsList = instructionsEl.createEl("ol");
		instructionsList.createEl("li", {
			text: "Get your OpenAI API key from https://platform.openai.com/api-keys",
		});
		instructionsList.createEl("li", {
			text: "Paste your API key in the field above",
		});
		instructionsList.createEl("li", {
			text: "If you're getting rate limited, add your organization ID (org-...)",
		});
		instructionsList.createEl("li", {
			text: "Choose your preferred model",
		});
		instructionsList.createEl("li", {
			text: "Start chatting! Use the ribbon icon or command palette",
		});

		const warningEl = instructionsEl.createDiv();
		warningEl.style.cssText = `
			margin-top: 8px;
			font-size: 0.9em;
			color: var(--text-muted);
		`;
		warningEl.innerHTML =
			'<strong>Note:</strong> API usage will be charged to your OpenAI account. Check pricing at <a href="https://openai.com/pricing" target="_blank">openai.com/pricing</a>';
	}
}
