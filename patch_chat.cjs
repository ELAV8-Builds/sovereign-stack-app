const fs = require('fs');
let content = fs.readFileSync('/workspace/sovereign-stack-app/src/components/ChatInterface.tsx', 'utf8');

// 1. Add markConversationRead in handleSelectFleetAgent after loading messages
const fleet1 = `if (conv && conv.messages) {
            setMessages(conv.messages.map(apiToLocal));
          }
        } catch {
          // Conversation might not have messages yet`;

const fleet1_new = `if (conv && conv.messages) {
            setMessages(conv.messages.map(apiToLocal));
          }
          // Mark as read when we view it
          markConversationRead(agent.conversation_id);
        } catch {
          // Conversation might not have messages yet`;

if (content.includes(fleet1)) {
  content = content.replace(fleet1, fleet1_new);
  console.log('✅ Patched fleet agent conversation read marking');
} else {
  console.log('⚠️ Fleet agent pattern not found (may already be patched)');
}

// 2. Add markConversationRead in handleNewConversation
const newConv = `// Reset scroll tracking on new conversation
      userScrolledUpRef.current = false;
    } catch {`;

const newConv_new = `// Reset scroll tracking on new conversation
      userScrolledUpRef.current = false;
      // Mark new conversation as read immediately
      markConversationRead(conv.id);
    } catch {`;

if (content.includes(newConv)) {
  content = content.replace(newConv, newConv_new);
  console.log('✅ Patched new conversation read marking');
} else {
  console.log('⚠️ New conversation pattern not found');
}

// 3. Add markConversationRead when user sends a message
const sendMsg = `addMessage(convId, "user", trimmed).catch(() => {});
    }

    try {
      if (agentMode) {`;

const sendMsg_new = `addMessage(convId, "user", trimmed).catch(() => {});
    }

    // Mark conversation as read since user is actively interacting
    if (convId) {
      markConversationRead(convId);
    }

    try {
      if (agentMode) {`;

if (content.includes(sendMsg)) {
  content = content.replace(sendMsg, sendMsg_new);
  console.log('✅ Patched send message read marking');
} else {
  console.log('⚠️ Send message pattern not found');
}

// 4. Add playNotificationDing in onMessage callback
const onMsg = `addMessage(convId, "agent", text).catch(() => {});
            }
          },
          onError:`;

const onMsg_new = `addMessage(convId, "agent", text).catch(() => {});
            }

            // Play notification ding — the agent just finished responding
            playNotificationDing();
          },
          onError:`;

if (content.includes(onMsg)) {
  content = content.replace(onMsg, onMsg_new);
  console.log('✅ Patched notification ding on agent response');
} else {
  console.log('⚠️ onMessage pattern not found');
}

// Verify
const markCount = (content.match(/markConversationRead/g) || []).length;
const dingCount = (content.match(/playNotificationDing/g) || []).length;
console.log(`\n📊 Results: markConversationRead=${markCount}, playNotificationDing=${dingCount}`);

if (markCount < 2) console.log('⚠️ Expected at least 2 markConversationRead calls');
if (dingCount < 1) console.log('⚠️ Expected at least 1 playNotificationDing call');

fs.writeFileSync('/workspace/sovereign-stack-app/src/components/ChatInterface.tsx', content);
console.log('\n✅ ChatInterface.tsx written!');
