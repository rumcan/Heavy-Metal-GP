// ══════════════════════════════════════════════════════════════════════════
// MP-CHAT — TWO-BROWSER E2E TEST: Lobby Pit Wall & Mid-Race Speech Bubbles.
//
// Tests that:
// 1. In the lobby, the host and guest can exchange messages in real time.
//    - Sender sees 'YOU' (.is-player), receiver sees the incoming line (!.is-player).
//    - Clamping to MAX_CHAT_LENGTH and disabled submit on empty text.
// 2. Mid-race, drivers can talk using the 'T' key or the chat button.
//    - Escape dismisses the compose bar.
//    - Sent lines appear as speech bubbles pinned to the speaking marble's seat
//      ([data-seat="0"] for host, [data-seat="1"] for guest) on BOTH screens.
//    - Bubbles expire and vanish after CHAT_BUBBLE_MS.
// ══════════════════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { MpSuite, unavailable } from './mp-harness';
import { MAX_CHAT_LENGTH } from '../../src/net/protocol';

const skip = await unavailable();
let suite: MpSuite | null = null;
async function open(): Promise<MpSuite> {
  suite ??= await MpSuite.open();
  return suite;
}
after(async () => void (await Promise.resolve(suite?.close())));

test('MP-CHAT E2E: lobby pit wall chat exchanges messages between host and guest', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const code = await host.roomCode();

  const guest = await mp.player('guest');
  await guest.joinGame(code);

  // Both should see the empty state initially
  await host.page.locator('.lobby-chat-empty').waitFor({ timeout: 20_000 });
  await guest.page.locator('.lobby-chat-empty').waitFor({ timeout: 20_000 });

  const hostInput = host.page.locator('.lobby-chat-form input[aria-label="Message the lobby"]');
  const hostSendBtn = host.page.locator('.lobby-chat-form button[aria-label="Send message"]');
  const guestInput = guest.page.locator('.lobby-chat-form input[aria-label="Message the lobby"]');
  const guestSendBtn = guest.page.locator('.lobby-chat-form button[aria-label="Send message"]');

  // Verify empty input cannot be sent
  assert.equal(await hostSendBtn.isDisabled(), true, 'host send button is disabled when draft is empty');
  assert.equal(await guestSendBtn.isDisabled(), true, 'guest send button is disabled when draft is empty');

  // Host sends a message
  const hostMsg = 'Good luck on the track!';
  await hostInput.fill(hostMsg);
  assert.equal(await hostSendBtn.isDisabled(), false);
  await hostSendBtn.click();

  // Host sees their own message marked with is-player and labelled YOU
  const hostLogItem = host.page.locator('.lobby-chat-log li.is-player');
  await hostLogItem.waitFor({ timeout: 10_000 });
  assert.match(await hostLogItem.innerText(), /YOU/);
  assert.match(await hostLogItem.innerText(), new RegExp(hostMsg));

  // Guest sees host's message as an incoming message (not is-player)
  const guestReceivedItem = guest.page.locator('.lobby-chat-log li:not(.is-player)');
  await guestReceivedItem.waitFor({ timeout: 10_000 });
  assert.match(await guestReceivedItem.innerText(), new RegExp(hostMsg));

  // Guest replies using Enter key
  const guestMsg = 'Watch your mirrors!';
  await guestInput.fill(guestMsg);
  await guestInput.press('Enter');

  // Guest sees their own reply as is-player
  const guestMyItem = guest.page.locator('.lobby-chat-log li.is-player');
  await guestMyItem.waitFor({ timeout: 10_000 });
  assert.match(await guestMyItem.innerText(), /YOU/);
  assert.match(await guestMyItem.innerText(), new RegExp(guestMsg));

  // Host sees guest's reply as not is-player
  const hostReceivedItem = host.page.locator('.lobby-chat-log li:not(.is-player)');
  await hostReceivedItem.waitFor({ timeout: 10_000 });
  assert.match(await hostReceivedItem.innerText(), new RegExp(guestMsg));

  // Test character limit clamping in input
  const longText = 'A'.repeat(MAX_CHAT_LENGTH + 20);
  await hostInput.fill(longText);
  const val = await hostInput.inputValue();
  assert.equal(val.length, MAX_CHAT_LENGTH, `input clamped to MAX_CHAT_LENGTH (${MAX_CHAT_LENGTH})`);
});

test('MP-CHAT E2E: mid-race speech bubbles appear on both screens and expire', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const code = await host.roomCode();

  const guest = await mp.player('guest');
  await guest.joinGame(code);

  await guest.setReady();
  await host.setReady();
  await host.page.locator('.fit-actions p').getByText(/drop the lights/i).waitFor({ timeout: 20_000 });
  await host.startRace();

  await guest.race();
  await guest.waitForGate();
  await host.waitForGate();

  // 1. Test opening and closing compose bar with Escape on Host
  const hostChatOpenBtn = host.page.locator('.race-chat-open');
  await hostChatOpenBtn.waitFor({ timeout: 20_000 });
  await hostChatOpenBtn.click();

  const hostRaceChatForm = host.page.locator('form.race-chat');
  await hostRaceChatForm.waitFor({ timeout: 10_000 });
  const hostRaceInput = hostRaceChatForm.locator('input[aria-label="Message the grid"]');
  assert.equal(await hostRaceInput.isVisible(), true);

  // Press Escape to dismiss compose bar
  await hostRaceInput.press('Escape');
  await hostRaceChatForm.waitFor({ state: 'detached', timeout: 10_000 });

  // 2. Guest presses 'KeyT' to open race chat compose bar
  await guest.page.keyboard.press('KeyT');
  const guestRaceChatForm = guest.page.locator('form.race-chat');
  await guestRaceChatForm.waitFor({ timeout: 10_000 });
  const guestRaceInput = guestRaceChatForm.locator('input[aria-label="Message the grid"]');

  // Guest types message and sends via Enter
  const guestRaceMsg = 'See you at the apex!';
  await guestRaceInput.fill(guestRaceMsg);
  await guestRaceInput.press('Enter');

  // Compose bar should close on submit
  await guestRaceChatForm.waitFor({ state: 'detached', timeout: 10_000 });

  // 3. Speech bubble should appear on Guest screen pinned to seat 1 (guest)
  const guestBubble = guest.page.locator('.race-bubbles .race-bubble[data-seat="1"]').filter({ hasText: guestRaceMsg });
  await guestBubble.waitFor({ timeout: 10_000 });
  assert.match(await guestBubble.innerText(), /YOU/);
  assert.match(await guestBubble.innerText(), new RegExp(guestRaceMsg));

  // 4. Speech bubble should also appear on Host screen pinned to seat 1 (guest)
  const hostBubble = host.page.locator('.race-bubbles .race-bubble[data-seat="1"]').filter({ hasText: guestRaceMsg });
  await hostBubble.waitFor({ timeout: 10_000 });
  assert.match(await hostBubble.innerText(), new RegExp(guestRaceMsg));

  // 5. Host sends a response using 'T' key
  await host.page.keyboard.press('KeyT');
  await hostRaceChatForm.waitFor({ timeout: 10_000 });
  const hostRaceMsg = 'Not if I pass you first!';
  await hostRaceInput.fill(hostRaceMsg);
  await hostRaceInput.press('Enter');
  await hostRaceChatForm.waitFor({ state: 'detached', timeout: 10_000 });

  // Host's speech bubble is pinned to seat 0 (host) on both screens
  const hostBubble2 = host.page.locator('.race-bubbles .race-bubble[data-seat="0"]').filter({ hasText: hostRaceMsg });
  await hostBubble2.waitFor({ timeout: 10_000 });
  assert.match(await hostBubble2.innerText(), /YOU/);
  assert.match(await hostBubble2.innerText(), new RegExp(hostRaceMsg));

  const guestBubble2 = guest.page.locator('.race-bubbles .race-bubble[data-seat="0"]').filter({ hasText: hostRaceMsg });
  await guestBubble2.waitFor({ timeout: 10_000 });
  assert.match(await guestBubble2.innerText(), new RegExp(hostRaceMsg));

  // 6. Wait for bubbles to expire (CHAT_BUBBLE_MS = 4000ms)
  await host.page.waitForTimeout(4500);
  assert.equal(await host.page.locator('.race-bubbles .race-bubble').count(), 0, 'bubbles expired on host');
  assert.equal(await guest.page.locator('.race-bubbles .race-bubble').count(), 0, 'bubbles expired on guest');
});
