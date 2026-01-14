# LLM Browser Bot - Instructions for AI Assistants

## Quick Reference

### Getting Started
1. **List available tabs**: Use `list_tabs` to see connected browser tabs
2. **Get the tabId**: Extract `tabId` from the response - you need this for all commands
3. **Navigate**: Use `navigate` with `tabId` and `url` to go to a page
4. **Interact**: Use `click`, `fill`, `select`, etc. to interact with elements

### Tool Naming Convention
All multi-word tool names use **underscores**:
- `list_tabs` (not listTabs)
- `tab_detail` (not tabDetail)
- `console_logs` (not consoleLogs)
- `elements_from_point` (not elementsFromPoint)

### Essential Tools

| Tool | Purpose | Required Params |
|------|---------|-----------------|
| `list_tabs` | Get all connected tabs | none |
| `navigate` | Go to URL | `tabId`, `url` |
| `click` | Click element | `tabId`, `selector` or `xpath` |
| `fill` | Enter text in input | `tabId`, `selector` or `xpath`, `value` |
| `screenshot` | Capture page image | `tabId` |
| `elements` | Query multiple elements | `tabId`, `selector` or `xpath` |

## Best Practices

### 1. Always Get tabId First
```
Step 1: Call list_tabs
Step 2: Extract tabId from response
Step 3: Use tabId in all subsequent commands
```

### 2. Use CSS Selectors or XPath (not both)
```json
// CSS selector (preferred for simple cases)
{ "tabId": "abc123", "selector": "#submit-button" }

// XPath (better for text-based selection)
{ "tabId": "abc123", "xpath": "//button[contains(text(), 'Submit')]" }
```

### 3. First Match Only
Tools operate on the **first matching element**. If multiple elements match:
- Use more specific selectors
- Use `elements` tool to find the right one first
- Use XPath with text content for precision

### 4. Check Element Visibility
Before clicking hidden elements:
```json
{ "tabId": "abc123", "selector": ".menu-item", "visible": "true" }
```

### 5. Handle Dynamic Content
For pages that load content asynchronously:
- Use `wait_for_element` before interacting
- Add delays between navigation and interaction
- Check `elements` to verify element exists

## Common Patterns

### Form Submission
```
1. navigate to form page
2. fill username field
3. fill password field
4. click submit button
```

### Search and Click Result
```
1. fill search input
2. keypress Enter or click search button
3. wait_for_element for results
4. click desired result
```

### Screenshot Workflow
```
1. navigate to page
2. (optional) scroll to element
3. screenshot with selector for specific area
```

## Error Handling

### "Element not found"
- Verify selector is correct
- Check if element is visible
- Wait for dynamic content to load
- Try XPath if CSS selector fails

### "Tab not found"
- Call `list_tabs` to get current tabs
- Tab may have disconnected
- Reopen DevTools panel

### Command timeout
- Increase `timeout` parameter
- Check for JavaScript errors via `console_logs`
- Page may be unresponsive

## Tool Categories

### Navigation
- `navigate` - Go to URL
- `back` - Browser back
- `forward` - Browser forward
- `reload` - Refresh page
- `scroll` - Scroll page

### Interaction
- `click` - Click element
- `hover` - Hover over element
- `fill` - Enter text in input
- `clear` - Clear input value
- `paste` - Paste text
- `select` - Select dropdown option
- `keypress` - Send keyboard event
- `type` - Type character by character
- `focus` / `blur` - Manage focus

### Information
- `screenshot` - Capture image
- `dom` - Get HTML content
- `elements` - Query elements
- `elements_from_point` - Get elements at coordinates
- `get_text` - Extract visible text
- `get_attribute` - Get element attribute
- `console_logs` - Get console output

### Tab Management
- `list_tabs` - List all tabs
- `tab_detail` - Get tab info
- `new_tab` - Open new tab
- `close` - Close tab
- `show` - Bring tab to front

### AI-Focused
- `page_structure` - Get page summary
- `labeled_screenshot` - Add numbered labels
- `clear_labels` - Remove labels
- `accessibility_tree` - Get a11y tree

## Parameter Tips

### Selectors
- Use IDs when available: `#my-id`
- Classes: `.my-class`
- Attributes: `[data-testid="submit"]`
- Combine: `form#login .submit-btn`

### XPath Examples
- By text: `//button[text()='Click Me']`
- Contains text: `//a[contains(text(), 'Learn')]`
- By attribute: `//*[@data-id='123']`
- Nth element: `(//div[@class='item'])[2]`

### Timeouts
- Default: 5000ms (5 seconds)
- Navigation: 30000ms (30 seconds)
- Click: 8000ms (allows for animations)
- Increase for slow pages

## Response Format

All tools return:
```json
{
  "success": true,
  "selector": "actual-selector-used",
  "url": "current-page-url",
  "title": "current-page-title",
  // ... tool-specific data
}
```

## Remember

1. **tabId is required** for almost every tool
2. **Use underscores** in multi-word tool names
3. **First match wins** - be specific with selectors
4. **Check visibility** before interacting
5. **Wait for content** on dynamic pages
