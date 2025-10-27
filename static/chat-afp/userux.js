const queryInput = document.getElementById('queryInput');
const submitButton = document.getElementById('submitButton');
const errorMessage = document.getElementById('errorMessage');
const loading = document.getElementById('loading');
const chatContainer = document.getElementById('chatContainer');
const chatHistory = document.getElementById('chatHistory');
const themeIcon = document.getElementById('theme-icon');

let chatSessions = [];
let currentSessionId = null;

// Local Storage with Error Handling
function loadChatSessions() {
    try {
        const savedSessions = localStorage.getItem('chatSessions');
        if (savedSessions) {
            chatSessions = JSON.parse(savedSessions) || [];
            // Validate sessions
            chatSessions = chatSessions.filter(session => 
                session.id && session.title && Array.isArray(session.messages)
            );
        }
    } catch (error) {
        console.error('Error loading chat sessions:', error);
        chatSessions = [];
        showError('Failed to load chat history');
    }
}

function saveChatSessions() {
    try {
        localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
    } catch (error) {
        console.error('Error saving chat sessions:', error);
        showError('Failed to save chat session');
    }
}

// Theme Management
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    themeIcon.innerHTML = theme === 'light' ? 
        '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' :
        '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

// Initialize Theme and Chat
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    loadChatSessions();
    initializeChat();
});

function scrollToBottom() {
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

function addMessage(content, isUser, sessionId) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'} fade-in`;
    messageDiv.innerHTML = `<div>${marked.parse(content, { gfm: true, breaks: true })}</div>`;
    chatContainer.appendChild(messageDiv);
    scrollToBottom();

    if (sessionId) {
        const session = chatSessions.find(s => s.id === sessionId);
        if (session) {
            session.messages.push({ content, isUser });
            saveChatSessions();
        }
    }
}

function renderChatHistory() {
    chatHistory.innerHTML = '';
    chatSessions.forEach(session => {
        const historyItem = document.createElement('div');
        historyItem.className = `chat-history-item ${session.id === currentSessionId ? 'active' : ''}`;
        historyItem.innerHTML = `
            <span class="truncate flex-grow">${session.title}</span>
            <button class="delete-btn" onclick="deleteChatSession('${session.id}', event)">
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
            </button>
        `;
        historyItem.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-btn')) {
                loadChatSession(session.id);
            }
        });
        chatHistory.appendChild(historyItem);
    });
}

function deleteChatSession(sessionId, event) {
    event.stopPropagation();
    chatSessions = chatSessions.filter(s => s.id !== sessionId);
    if (currentSessionId === sessionId) {
        currentSessionId = null;
        chatContainer.innerHTML = `
            <div class="welcome-section">
                <h1 class="welcome-header">AFP AI Assistant</h1>
                <p class="welcome-subheader">Your trusted source for polio information and prevention</p>
            </div>
        `;
    }
    saveChatSessions();
    renderChatHistory();
    scrollToBottom();
}

function startNewChat() {
    currentSessionId = Date.now().toString();
    chatSessions.push({
        id: currentSessionId,
        title: 'New Chat',
        messages: []
    });
    chatContainer.innerHTML = `
        <div class="welcome-section">
            <h1 class="welcome-header">AFP AI Assistant</h1>
            <p class="welcome-subheader">Your trusted source for polio information and prevention</p>
        </div>
    `;
    queryInput.value = '';
    saveChatSessions();
    renderChatHistory();
    scrollToBottom();
}

function loadChatSession(sessionId) {
    currentSessionId = sessionId;
    const session = chatSessions.find(s => s.id === sessionId);
    chatContainer.innerHTML = `
        <div class="welcome-section">
            <h1 class="welcome-header">AFP AI Assistant</h1>
            <p class="welcome-subheader">Welcome to Polio/AFP assistant chatbot, what can i help you with?</p>
        </div>
    `;
    if (session) {
        session.messages.forEach(msg => {
            addMessage(msg.content, msg.isUser, null);
        });
    }
    renderChatHistory();
    scrollToBottom();
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    setTimeout(() => errorMessage.classList.add('hidden'), 3000);
}

async function handleSubmit() {
    const query = queryInput.value.trim();
    if (!query) {
        showError('Please enter a question.');
        return;
    }

    if (!currentSessionId) {
        currentSessionId = Date.now().toString();
        chatSessions.push({
            id: currentSessionId,
            title: query.substring(0, 30) + (query.length > 30 ? '...' : ''),
            messages: []
        });
    }

    addMessage(query, true, currentSessionId);
    queryInput.value = '';
    renderChatHistory();

    try {
        loading.classList.remove('hidden');
        const response = await fetch('/rag_query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch response from server.');
        }

        const data = await response.json();
        addMessage(data.response || 'No response generated.', false, currentSessionId);

        const session = chatSessions.find(s => s.id === currentSessionId);
        if (session && session.title === 'New Chat') {
            session.title = query.substring(0, 30) + (query.length > 30 ? '...' : '');
            saveChatSessions();
            renderChatHistory();
        }
    } catch (error) {
        showError('An error occurred while processing your request.');
        console.error(error);
    } finally {
        loading.classList.add('hidden');
    }
}

function initializeChat() {
    if (chatSessions.length > 0) {
        currentSessionId = chatSessions[chatSessions.length - 1].id;
        loadChatSession(currentSessionId);
    } else {
        startNewChat();
    }
    renderChatHistory();
    scrollToBottom();
}

submitButton.addEventListener('click', handleSubmit);
queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSubmit();
    }
});