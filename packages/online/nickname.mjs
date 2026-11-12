/** Account presentation only; identity, session ownership and history keys stay separate. */
export const NICKNAME_MAX_LENGTH = 16;

export function normalizeNickname(value) {
  if (typeof value !== 'string') throw new TypeError('Nickname must be text');
  const nickname = value.normalize('NFC').trim();
  if (!nickname || [...nickname].length > NICKNAME_MAX_LENGTH)
    throw new TypeError(`Nickname must be between 1 and ${NICKNAME_MAX_LENGTH} characters`);
  // Invisible formatting/control characters and malformed UTF-16 cannot be names.
  // Accepted names are rendered with textContent, never as HTML.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(nickname))
    throw new TypeError('Nickname cannot contain control or invisible formatting characters');
  return nickname;
}
