// WeChat routes may supply either the original value or the encoded query value.
// Match literal IDs first so IDs containing a real "%xx" sequence are not decoded twice.
function findByRouteId(items, value) {
  if (!Array.isArray(items) || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const raw=String(value);
  if (!raw) return null;
  const exact=items.find(item=>item&&item.id===raw);
  if (exact) return exact;
  let decoded;
  try { decoded=decodeURIComponent(raw); } catch(error) { return null; }
  if (decoded===raw) return null;
  return items.find(item=>item&&item.id===decoded)||null;
}
module.exports={findByRouteId};
