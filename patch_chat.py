import re

with open('/workspace/sovereign-stack-app/src/components/ChatInterface.tsx', 'r') as f:
    content = f.read()

# 1. Add markConversationRead in handleSelectFleetAgent after loading messages
# Find the pattern in handleSelectFleetAgent where we load fleet agent conversation
old_fleet_load = """          if (conv && conv.messages) {
            setMessages(conv.messages.map(apiToLocal));
          }
        } catch {
          // Conversation might not have messages yet — that's fine
        }"""

new_fleet_load = """          if (conv && conv.messages) {
            setMessages(conv.messages.map(apiToLocal));
          }
          // Mark as read when we view it
          markConversationRead(agent.conversation_id);
        } catch {
          // Conversation might not have messages yet — that's fine
        }"""

content = content.replace(old_fleet_load, new_fleet_load)

# 2. Add markConversationRead in handleNewConversation
old_new_conv = """      // Reset scroll tracking on new conversation
      userScrolledUpRef.current = false;"""

new_new_conv = """      // Reset scroll tracking on new conversation
      userScrolledUpRef.current = false;
      // Mark new conversation as read immediately
      markConversationRead(conv.id);"""

content = content.replace(old_new_conv, new_new_conv)

# 3. Add markConversationRead when user sends a message
old_send_persist = """    // Persist user message
    if (convId && apiAvailable !== false) {
      addMessage(convId, "user", trimmed).catch(() => {});
    }

    try {"""

new_send_persist = """    // Persist user message
    if (convId && apiAvailable !== false) {
      addMessage(convId, "user", trimmed).catch(() => {});
    }

    // Mark conversation as read since user is actively interacting
    if (convId) {
      markConversationRead(convId);
    }

    try {"""

content = content.replace(old_send_persist, new_send_persist)

# 4. Add playNotificationDing in onMessage callback
old_on_message = """            // Persist agent response
            if (convId && apiAvailable !== false) {
              addMessage(convId, "agent", text).catch(() => {});
            }"""

new_on_message = """            // Persist agent response
            if (convId && apiAvailable !== false) {
              addMessage(convId, "agent", text).catch(() => {});
            }

            // Play notification ding — the agent just finished responding
            playNotificationDing();"""

content = content.replace(old_on_message, new_on_message)

# 5. Also need to add MarkdownRenderer import if missing (it's already there)
# Just verify the imports are correct
assert 'import { markConversationRead }' in content, "markConversationRead import missing!"
assert 'import { playNotificationDing }' in content, "playNotificationDing import missing!"

with open('/workspace/sovereign-stack-app/src/components/ChatInterface.tsx', 'w') as f:
    f.write(content)

print("✅ ChatInterface.tsx patched successfully!")
print(f"  - markConversationRead: {content.count('markConversationRead')} occurrences")
print(f"  - playNotificationDing: {content.count('playNotificationDing')} occurrences")
