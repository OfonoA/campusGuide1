document.addEventListener("DOMContentLoaded", () => {
  const queryInput = document.getElementById("query-input");
  const sendButton = document.getElementById("send-button");
  const chatWindow = document.querySelector(".chat-window");
  const logoutButton = document.getElementById("logout-button");
  const chatHistoryContainer = document.querySelector(".chat-history");
  const newChatButton = document.getElementById("new-chat-button");
  const usernameDisplay = document.getElementById("username-display");

  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebar = document.querySelector(".sidebar");
  const sidebarOverlay = document.createElement("div");
  sidebarOverlay.className = "sidebar-overlay";
  document.body.appendChild(sidebarOverlay);
  let activeChatId = null;
  let isTyping = false;
  let chatHistory = [];

  // Toggle sidebar function
  function toggleSidebar() {
    sidebar.classList.toggle("collapsed");

    // Update chevron icon
    const icon = sidebarToggle.querySelector("i");
    if (sidebar.classList.contains("collapsed")) {
      icon.classList.remove("fa-chevron-left");
      icon.classList.add("fa-chevron-right");
    } else {
      icon.classList.remove("fa-chevron-right");
      icon.classList.add("fa-chevron-left");
    }
  }

  // Add event listeners
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", toggleSidebar);
  }

  // Close sidebar when clicking overlay
  sidebarOverlay.addEventListener("click", toggleSidebar);

  // Make sure to add this to your existing media query checks
  function handleResize() {
    if (window.innerWidth > 992) {
      sidebar.classList.remove("collapsed");
    }
  }

  window.addEventListener("resize", handleResize);

  // Updated JavaScript functions
  function showTypingIndicator() {
    const indicator = document.getElementById("typing-indicator");
    if (indicator) {
      // Reset animation
      indicator.classList.remove("active");
      void indicator.offsetWidth; // Trigger reflow

      indicator.classList.add("active");
      indicator.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }

  function hideTypingIndicator() {
    const indicator = document.getElementById("typing-indicator");
    if (indicator) {
      indicator.classList.remove("active");
    }
  }

  // --- Message Functions ---
  function displayMessage(message, sender) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", `${sender}-message`);
    if (sender === "bot") {
      messageDiv.innerHTML = marked.parse(message);
    } else {
      messageDiv.textContent = message;
    }

    // Insert before typing indicator
    const typingIndicator = document.getElementById("typing-indicator");
    chatWindow.insertBefore(messageDiv, typingIndicator);

    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Update chat history
    if (sender === "user") {
      const lastBotResponse =
        chatHistory.length > 0 ? chatHistory[chatHistory.length - 1][1] : "";
      if (chatHistory.length === 0 || lastBotResponse !== "") {
        chatHistory.push([message, ""]);
      } else if (chatHistory.length > 0) {
        chatHistory[chatHistory.length - 1][0] = message;
      }
    } else if (sender === "bot") {
      if (chatHistory.length > 0) {
        chatHistory[chatHistory.length - 1][1] = message;
      }
    }

    if (chatHistory.length > 3) {
      chatHistory = chatHistory.slice(-3);
    }
  }

  // --- Chat Handling ---
  async function handleSendMessage() {
    const query = queryInput.value.trim();
    if (query) {
      const token = localStorage.getItem("authToken");
      displayMessage(query, "user");
      queryInput.value = "";

      // Show typing indicator with slight delay
      setTimeout(showTypingIndicator, 100);

      try {
        const response = await fetch("/chat/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: query,
            chat_history: chatHistory,
            chat_id: activeChatId,
          }),
        });

        // Only hide after we get the response
        if (response.ok) {
          const data = await response.json();
          hideTypingIndicator();
          displayMessage(data.response, "bot");
          if (!activeChatId) {
            activeChatId = data.chat_id;
            fetchChatHistory();
          }
        } else {
          hideTypingIndicator();
          const errorData = await response.json();
          displayMessage(errorData.message || "Error sending message.", "bot");
        }
      } catch (error) {
        hideTypingIndicator();
        displayMessage("Error communicating with the bot.", "bot");
      }
    }
  }

  // --- Chat History Management ---
  function setActiveChat(chatItem) {
    document.querySelector(".chat-item.active")?.classList.remove("active");
    chatItem.classList.add("active");
    activeChatId = chatItem.dataset.chatId;
    chatWindow.innerHTML = "";
    chatHistory = [];
    loadChatMessages(activeChatId);
  }

  async function fetchChatHistory() {
    const token = localStorage.getItem("authToken");
    if (!token) return;

    try {
      const response = await fetch("/api/chats", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const history = await response.json();
        renderChatHistory(history);
      }
    } catch (error) {
      console.error("Error fetching chat history:", error);
    }
  }

  function renderChatHistory(history) {
    chatHistoryContainer.innerHTML = "";
    history.forEach((chat) => {
      const chatItem = document.createElement("div");
      chatItem.classList.add("chat-item");
      chatItem.textContent = chat.title || `Chat ${chat.id}`;
      chatItem.dataset.chatId = chat.id;
      chatItem.addEventListener("click", () => setActiveChat(chatItem));
      chatHistoryContainer.appendChild(chatItem);
    });

    if (
      history.length > 0 &&
      !activeChatId &&
      chatHistoryContainer.firstChild
    ) {
      setActiveChat(chatHistoryContainer.firstChild);
    }
  }

  async function loadChatMessages(chatId) {
    const token = localStorage.getItem("authToken");
    if (!token || !chatId) return;

    try {
      const response = await fetch(`/api/chats/${chatId}/messages`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const messages = await response.json();
        chatHistory = [];
        messages.forEach((msg) => displayMessage(msg.content, msg.sender));
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }
    } catch (error) {
      console.error(`Error loading messages for chat ${chatId}:`, error);
    }
  }

  // --- Auth Functions ---
  async function checkAuthAndFetchData() {
    if (window.location.pathname.includes("/index.html")) {
      const isAuthenticated = await checkAuth();
      if (isAuthenticated) {
        fetchChatHistory();
        const token = localStorage.getItem("authToken");
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            usernameDisplay.textContent = payload?.username || "Logged In";
          } catch (error) {
            usernameDisplay.textContent = "Logged In";
          }
        }
      }
    }
  }

  async function checkAuth() {
    const token = localStorage.getItem("authToken");
    if (!token) {
      window.location.href = "login.html";
      return false;
    }

    try {
      const response = await fetch("/api/check_auth", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        localStorage.removeItem("authToken");
        window.location.href = "login.html";
        return false;
      }
      return true;
    } catch (error) {
      localStorage.removeItem("authToken");
      window.location.href = "login.html";
      return false;
    }
  }

  async function logout() {
    const token = localStorage.getItem("authToken");
    if (token) {
      try {
        await fetch("/api/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        console.error("Error during logout:", error);
      }
      localStorage.removeItem("authToken");
      window.location.href = "login.html";
    }
  }

  // --- Event Listeners ---
  if (newChatButton) {
    newChatButton.addEventListener("click", () => {
      chatWindow.innerHTML = "";
      document.querySelector(".chat-item.active")?.classList.remove("active");
      activeChatId = null;
      chatHistory = [];
    });
  }

  if (sendButton) {
    sendButton.addEventListener("click", handleSendMessage);
  }

  if (queryInput) {
    queryInput.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        handleSendMessage();
        event.preventDefault();
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  checkAuthAndFetchData();
});

// --- Form Handling ---
function validateForm(formId) {
  const form = document.getElementById(formId);
  return form.checkValidity();
}

// Login Form
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateForm("loginForm")) return;

    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;
    const errorDiv = document.getElementById("loginError");
    errorDiv.textContent = "";

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem("authToken", data.token);
        window.location.href = "index.html";
      } else {
        errorDiv.textContent = data.message || "Login failed";
      }
    } catch (error) {
      errorDiv.textContent = "Network error during login";
    }
  });
}

// Signup Form
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateForm("signupForm")) return;

    const username = document.getElementById("signupUsername").value;
    const password = document.getElementById("signupPassword").value;
    const errorDiv = document.getElementById("signupError");
    errorDiv.textContent = "";

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Account created successfully. Please log in.");
        window.location.href = "login.html";
      } else {
        errorDiv.textContent = data.message || "Signup failed";
      }
    } catch (error) {
      errorDiv.textContent = "Network error during signup";
    }
  });
}
