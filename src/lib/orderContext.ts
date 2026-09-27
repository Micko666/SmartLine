/** Delivery details are scoped to this tab and never transported in URLs. */
export function saveDeliveryAddress(token: string, address: string) {
  try { sessionStorage.setItem('smartline-delivery-' + token, JSON.stringify({address, expiresAt: Date.now() + 2 * 60 * 60 * 1000})); } catch { /* Browser storage unavailable. */ }
}
export function loadDeliveryAddress(token: string): string {
  try { const value = JSON.parse(sessionStorage.getItem('smartline-delivery-' + token) || 'null'); return value && value.expiresAt > Date.now() && typeof value.address === 'string' ? value.address : ''; } catch { return ''; }
}
