/** Optional browser ICE policy. There is no bundled public STUN/TURN service. */
export function normalizeIceServers(value = []) {
  if (!Array.isArray(value) || value.length > 8 || JSON.stringify(value).length > 8192) throw Error('invalid-rtc-ice-servers');
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some(key => !['urls', 'username', 'credential'].includes(key))) throw Error('invalid-rtc-ice-servers');
    const urls = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > 8 || urls.some(url => {
      if (typeof url !== 'string' || url.length > 256) return true;
      const match = /^(stun|stuns|turn|turns):(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(?:udp|tcp))?$/.exec(url);
      return !match || match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535);
    }) || ['username', 'credential'].some(key => entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > 256))) throw Error('invalid-rtc-ice-servers');
    return {urls: [...urls], ...(entry.username !== undefined ? {username: entry.username} : {}),
      ...(entry.credential !== undefined ? {credential: entry.credential} : {})};
  });
}
