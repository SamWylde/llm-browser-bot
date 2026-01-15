# Gemini Project: LLM Browser Bot

This document provides a high-level overview of the LLM Browser Bot project, intended to be used as a reference for AI assistants.

## Project Goal

The primary goal of the LLM Browser Bot project is to create a Chrome DevTools Extension that enables browser automation through the Model Context Protocol (MCP). It allows AI applications like Claude to control web browsers via a three-layer architecture: Chrome Extension, MCP Server, and WebSocket Bridge.

## Key Directories

*   **`/extension`**: This is the core of the project, containing the source code for the Chrome extension.
    *   `manifest.json`: Defines the extension's properties, permissions, and components.
    *   `background.js`: The extension's service worker, handling background tasks and managing the extension's state.
    *   `content-script.js`: Injected into web pages to capture user interactions.
    *   `panel.js` & `panel.html`: The user interface for the extension's developer tools panel.
*   **`/server`**: Contains the Node.js MCP server that the extension communicates with. This server handles MCP protocol communication and routes commands to browser tabs.
*   **`/e2e`**: End-to-end tests for the project, ensuring that the extension and server work together as expected.
*   **`/website`**: Project documentation and website (GitHub Pages).
*   **`/test-app`**: A test web application used for testing the LLM Browser Bot extension.

## How it Works

1.  The user installs the LLM Browser Bot Chrome extension.
2.  The user opens the browser's developer tools and selects the "LLM Browser Bot" panel.
3.  The extension connects to the MCP server automatically.
4.  AI clients (like Claude Desktop) connect to the MCP server via stdio or WebSocket.
5.  The server routes commands to specific browser tabs based on tabId.
6.  The extension executes commands (click, navigate, fill, etc.) and returns results.

## Development & Testing

*   **Dependencies**: The project uses Node.js and has `package.json` files in the `/e2e` and `/server` directories.
*   **Testing**: End-to-end tests are located in the `/e2e` directory and can be run with `npm test`.
*   **Building**: The extension can be built and packaged using scripts in the `.github/workflows` directory.
