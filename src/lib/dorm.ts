import { z } from 'zod';

export type Room = { id: string; number: string; tenant: string; rent: number; water: number; electric: number };
/** Meter readings only. `paid`, `paidAt`, `issued` are legacy (v1) fields kept for reading old backups. */
export type Reading = { water: number; electric: number; paid?: boolean | undefined; paidAt?: string | undefined; issued?: boolean | undefined };
export type Settings = { name: string; address: string; phone: string; waterRate: number; electricRate: number; common: number; fine: number; fineMode: 'daily' | 'flat'; dueDay: number; bank: string; qr: string };
export type InvoiceEvent = { at: string; action: 'issued' | 'paid' | 'payment_undone' | 'voided' | 'migrated'; note?: string | undefined };
/** Snapshot taken at the moment of issue. Amounts never recompute from current settings. */
export type Invoice = {
  id: string; roomId: string; month: string; issuedAt: string; status: 'active' | 'void';
  roomNumber: string; tenant: string; dormName: string; dormAddress: string; dormPhone: string; bank: string;
  rent: number; waterPrev: number; waterCur: number; waterRate: number; electricPrev: number; electricCur: number; electricRate: number;
  common: number; total: number; dueDate: string; fine: number; fineMode: 'daily' | 'flat';
  paidAt?: string | undefined; replaces?: string | undefined; voidReason?: string | undefined; legacy?: boolean | undefined;
  history: InvoiceEvent[];
};
export type DormData = { version: 2; settings: Settings; rooms: Room[]; readings: Record<string, Record<string, Reading>>; invoices: Invoice[]; pro: boolean; demo: boolean };
export const STORAGE_KEY = 'offline-dorm-manager-v1';
export const money = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function toSatang(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('กรุณากรอกจำนวนเงินเป็นตัวเลข ไม่เกิน 2 ตำแหน่งทศนิยม');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('จำนวนเงินสูงเกินไป');
  return result;
}
export const roomLimit = (pro: boolean) => pro ? 100 : 5;
export const validLicense = (key: string) => key.trim().toUpperCase() === 'DORM2026-PRO';
export function emptyData(): DormData {
  return { version: 2, pro: false, demo: false, rooms: [], readings: {}, invoices: [], settings: { name: 'หอพักของฉัน', address: '', phone: '', waterRate: 1800, electricRate: 800, common: 0, fine: 0, fineMode: 'daily', dueDay: 5, bank: '', qr: '' } };
}
export const activeInvoice = (data: DormData, roomId: string, month: string) => data.invoices.find(i => i.roomId === roomId && i.month === month && i.status === 'active');
export function previousReading(data: DormData, room: Room, month: string) {
  const prior = data.invoices.filter(i => i.roomId === room.id && i.status === 'active' && i.month < month).sort((x, y) => x.month.localeCompare(y.month)).at(-1);
  return { water: prior?.waterCur ?? room.water, electric: prior?.electricCur ?? room.electric };
}
export function dueDate(month: string, day: number) {
  const [y = 2026, m = 1] = month.split('-').map(Number);
  return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
}
function lateDays(due: Date, until: Date) {
  return Math.max(0, Math.round((Date.UTC(until.getFullYear(), until.getMonth(), until.getDate()) - Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())) / 86400000));
}
/** Draft bill for a month that has no invoice yet, from current settings. */
export function calculateBill(data: DormData, room: Room, month: string) {
  const previous = previousReading(data, room, month);
  const reading = data.readings[month]?.[room.id];
  const current = { water: reading?.water ?? previous.water, electric: reading?.electric ?? previous.electric };
  const water = current.water - previous.water;
  const electric = current.electric - previous.electric;
  const waterCost = water * data.settings.waterRate;
  const electricCost = electric * data.settings.electricRate;
  return { previous, current, water, electric, waterCost, electricCost, due: dueDate(month, data.settings.dueDay), valid: water >= 0 && electric >= 0, total: room.rent + waterCost + electricCost + data.settings.common };
}
/** Figures of an issued invoice. The original total is frozen; late fees are a separate line, frozen at payment. */
export function invoiceFigures(inv: Invoice, now = new Date()) {
  const water = inv.waterCur - inv.waterPrev, electric = inv.electricCur - inv.electricPrev;
  const due = new Date(inv.dueDate);
  const days = lateDays(due, inv.paidAt ? new Date(inv.paidAt) : now);
  const lateFee = inv.status === 'active' && days > 0 ? inv.fine * (inv.fineMode === 'daily' ? days : 1) : 0;
  const status: 'paid' | 'overdue' | 'pending' | 'void' = inv.status === 'void' ? 'void' : inv.paidAt ? 'paid' : days > 0 ? 'overdue' : 'pending';
  return { water, electric, waterCost: water * inv.waterRate, electricCost: electric * inv.electricRate, due, days, lateFee, total: inv.total, grandTotal: inv.total + lateFee, status };
}
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export function issueInvoice(data: DormData, room: Room, month: string, now = new Date(), replaces?: string): DormData {
  if (activeInvoice(data, room.id, month)) throw new Error('ห้องนี้มีใบแจ้งหนี้ของเดือนนี้แล้ว หากผิดให้ยกเลิกแล้วออกใหม่');
  const bill = calculateBill(data, room, month);
  if (!bill.valid) throw new Error('เลขมิเตอร์ล่าสุดต้องไม่น้อยกว่าครั้งก่อน');
  const s = data.settings;
  const inv: Invoice = { id: uid(), roomId: room.id, month, issuedAt: now.toISOString(), status: 'active', roomNumber: room.number, tenant: room.tenant, dormName: s.name, dormAddress: s.address, dormPhone: s.phone, bank: s.bank,
    rent: room.rent, waterPrev: bill.previous.water, waterCur: bill.current.water, waterRate: s.waterRate, electricPrev: bill.previous.electric, electricCur: bill.current.electric, electricRate: s.electricRate,
    common: s.common, total: bill.total, dueDate: bill.due.toISOString(), fine: s.fine, fineMode: s.fineMode, replaces, history: [{ at: now.toISOString(), action: 'issued', note: replaces ? 'ออกใหม่แทนฉบับที่ยกเลิก' : undefined }] };
  return { ...data, readings: { ...data.readings, [month]: { ...data.readings[month], [room.id]: { water: bill.current.water, electric: bill.current.electric } } }, invoices: [...data.invoices, inv] };
}
export function setMeter(data: DormData, room: Room, month: string, field: 'water' | 'electric', value: number): DormData {
  if (activeInvoice(data, room.id, month)) throw new Error('ออกใบแจ้งหนี้แล้ว แก้เลขมิเตอร์ไม่ได้ ให้ยกเลิกบิลแล้วออกใหม่');
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) throw new Error('เลขมิเตอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0');
  const bill = calculateBill(data, room, month);
  return { ...data, readings: { ...data.readings, [month]: { ...data.readings[month], [room.id]: { water: bill.current.water, electric: bill.current.electric, [field]: value } } } };
}
function updateInvoice(data: DormData, id: string, fn: (i: Invoice) => Invoice): DormData {
  if (!data.invoices.some(i => i.id === id)) throw new Error('ไม่พบใบแจ้งหนี้');
  return { ...data, invoices: data.invoices.map(i => i.id === id ? fn(i) : i) };
}
export function recordPayment(data: DormData, id: string, paidAt: Date, now = new Date()): DormData {
  return updateInvoice(data, id, i => { if (i.status !== 'active') throw new Error('ใบแจ้งหนี้ถูกยกเลิกแล้ว'); if (i.paidAt) throw new Error('บันทึกรับชำระไปแล้ว');
    return { ...i, paidAt: paidAt.toISOString(), history: [...i.history, { at: now.toISOString(), action: 'paid', note: `รับเงินวันที่ ${paidAt.toLocaleDateString('th-TH')}` }] }; });
}
export function undoPayment(data: DormData, id: string, reason: string, now = new Date()): DormData {
  if (!reason.trim()) throw new Error('กรุณาระบุเหตุผล');
  return updateInvoice(data, id, i => { if (!i.paidAt) throw new Error('ยังไม่ได้รับชำระ');
    return { ...i, paidAt: undefined, history: [...i.history, { at: now.toISOString(), action: 'payment_undone', note: `${reason.trim()} (เดิมรับเงิน ${new Date(i.paidAt).toLocaleDateString('th-TH')})` }] }; });
}
export function voidInvoice(data: DormData, id: string, reason: string, now = new Date()): DormData {
  if (!reason.trim()) throw new Error('กรุณาระบุเหตุผลการยกเลิก');
  return updateInvoice(data, id, i => { if (i.status === 'void') throw new Error('ยกเลิกไปแล้ว'); if (i.paidAt) throw new Error('บิลที่รับชำระแล้ว ต้องยกเลิกการรับชำระก่อน');
    return { ...i, status: 'void', voidReason: reason.trim(), history: [...i.history, { at: now.toISOString(), action: 'voided', note: reason.trim() }] }; });
}
export const invoiceNumber = (i: Invoice, all: Invoice[]) => { const rev = all.filter(x => x.roomId === i.roomId && x.month === i.month).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).indexOf(i); return `${i.month.replace('-', '')}-${i.roomNumber}${rev > 0 ? `-R${rev}` : ''}`; };
export function sampleData(month: string): DormData {
  const data = emptyData();
  data.demo = true;
  data.settings = { ...data.settings, name: 'หอพักสุขใจ', address: '128 ซอยประชาอุทิศ 12 แขวงทุ่งครุ เขตทุ่งครุ กรุงเทพฯ 10140', phone: '081-234-5678', common: 10000, bank: 'ธนาคารกสิกรไทย · 123-4-56789-0 · สุขใจ ใจดี' };
  const names = ['กมลชนก ใจดี', 'ธนกร พงษ์สุข', 'พรทิพย์ แสงทอง', 'ณัฐวุฒิ บุญมี', 'วิภาดา รัตนชัย', 'กิตติพงษ์ วงศ์ดี', 'สุภาวดี มีสุข', 'พีรพล ตั้งใจ', 'อรทัย จันทร์งาม', 'วรพล สุขสวัสดิ์'];
  data.rooms = names.map((tenant, i) => ({ id: `demo-${i}`, number: `${i < 5 ? 1 : 2}0${i % 5 + 1}`, tenant, rent: (i < 5 ? 3500 : 4000) * 100, water: 120 + i * 32, electric: 1250 + i * 115 }));
  let out = data;
  const issuedAt = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 28);
  data.rooms.forEach((r, i) => { out = setMeter(out, r, month, 'water', r.water + 5 + i % 4); out = setMeter(out, r, month, 'electric', r.electric + 90 + i * 9); out = issueInvoice(out, r, month, issuedAt); });
  out.invoices.slice(0, 6).forEach(inv => { out = recordPayment(out, inv.id, dueDate(month, 5), issuedAt); });
  return out;
}
const integer = z.number().int().nonnegative().max(1000000000);
const roomSchema = z.object({ id: z.string().min(1), number: z.string().min(1).max(30), tenant: z.string().max(200), rent: integer, water: integer, electric: integer });
const settingsSchema = z.object({ name: z.string().min(1).max(200), address: z.string().max(2000), phone: z.string().max(50), waterRate: integer, electricRate: integer, common: integer, fine: integer, fineMode: z.enum(['daily', 'flat']), dueDay: z.number().int().min(1).max(28), bank: z.string().max(1000), qr: z.string().max(3000000).refine(v => !v || /^data:image\/(png|jpeg|webp);base64,/.test(v)) });
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const readingSchema = z.object({ water: integer, electric: integer, paid: z.boolean().optional(), paidAt: z.string().datetime().optional(), issued: z.boolean().optional() });
const base = { pro: z.boolean(), demo: z.boolean(), settings: settingsSchema, rooms: z.array(roomSchema).max(100), readings: z.record(monthKey, z.record(readingSchema)) };
const invoiceSchema = z.object({ id: z.string().min(1), roomId: z.string().min(1), month: monthKey, issuedAt: z.string().datetime(), status: z.enum(['active', 'void']), roomNumber: z.string().max(30), tenant: z.string().max(200), dormName: z.string().max(200), dormAddress: z.string().max(2000), dormPhone: z.string().max(50), bank: z.string().max(1000),
  rent: integer, waterPrev: integer, waterCur: integer, waterRate: integer, electricPrev: integer, electricCur: integer, electricRate: integer, common: integer, total: integer, dueDate: z.string().datetime(), fine: integer, fineMode: z.enum(['daily', 'flat']),
  paidAt: z.string().datetime().optional(), replaces: z.string().optional(), voidReason: z.string().max(1000).optional(), legacy: z.boolean().optional(),
  history: z.array(z.object({ at: z.string().datetime(), action: z.enum(['issued', 'paid', 'payment_undone', 'voided', 'migrated']), note: z.string().max(1000).optional() })) });
const v1 = z.object({ version: z.literal(1), ...base });
const v2 = z.object({ version: z.literal(2), ...base, invoices: z.array(invoiceSchema).max(100000) });
export const MIGRATION_NOTE = 'แปลงจากข้อมูลเวอร์ชันเก่า: ยอดคำนวณจากค่าเช่าและอัตรา ณ วันที่แปลง อาจไม่ตรงกับบิลที่ส่งให้ผู้เช่าจริง';
/** v1 never stored rates at issue time, so migrated invoices are flagged as reconstructed, not exact. */
export function migrateV1(old: z.infer<typeof v1>, now = new Date()): DormData {
  let data: DormData = { ...old, version: 2, invoices: [] };
  for (const month of Object.keys(old.readings).sort()) for (const room of old.rooms) {
    const r = old.readings[month]?.[room.id]; if (!r?.issued) continue;
    try { data = issueInvoice(data, room, month, now); } catch { continue; }
    const inv = data.invoices.at(-1); if (!inv) continue;
    inv.legacy = true; inv.history = [{ at: now.toISOString(), action: 'migrated', note: MIGRATION_NOTE }];
    if (r.paid) inv.paidAt = r.paidAt ?? now.toISOString();
  }
  return data;
}
export function parseBackup(input: unknown): DormData {
  const version = (input as { version?: unknown } | null)?.version;
  const data = version === 1 ? migrateV1(v1.parse(input)) : v2.parse(input);
  if (new Set(data.rooms.map(r => r.id)).size !== data.rooms.length || new Set(data.rooms.map(r => r.number)).size !== data.rooms.length) throw new Error('ข้อมูลห้องซ้ำกัน');
  if (!data.pro && !data.demo && data.rooms.length > 5) throw new Error('ข้อมูลเกินขีดจำกัด 5 ห้อง');
  return data;
}
export function monthLabel(month: string) { const [year = 2026, m = 1] = month.split('-').map(Number); return `${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][m - 1]} ${year + 543}`; }
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }