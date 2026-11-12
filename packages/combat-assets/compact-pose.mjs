/** Runtime storage only: retain the original double precision keys and times.
 * Packed channels remove one JS array allocation per animation key. Sources on
 * disk remain immutable and the sampler returns the same ordinary vectors. */
export function compactPoseDocument(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.frames) || !Array.isArray(document.clips)) return document;
  for (const clip of document.clips) for (const track of clip.tracks ?? []) {
    for (const property of ['translation', 'rotation', 'scale']) {
      const channel = track[property];
      if (!channel || channel.stride !== undefined) continue;
      const stride = property === 'rotation' ? 4 : 3;
      if (!Array.isArray(channel.times) || !Array.isArray(channel.values) || !channel.times.length
        || channel.times.length !== channel.values.length
        || channel.times.some((n,i) => !Number.isFinite(n) || i > 0 && n < channel.times[i-1])
        || channel.values.some(row => !Array.isArray(row) || row.length !== stride || row.some(n => !Number.isFinite(n)))) {
        throw Error('Invalid runtime pose channel: ' + clip.name + '/' + track.frame_name + '/' + property);
      }
      const values = new Float64Array(channel.values.length * stride);
      for (let i = 0; i < channel.values.length; i++) values.set(channel.values[i], i * stride);
      channel.times = Float64Array.from(channel.times);
      channel.values = values;
      channel.stride = stride;
    }
  }
  return document;
}
