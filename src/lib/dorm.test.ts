import { describe, it, expect } from 'vitest';
import { emptyData, toSatang, roomLimit, validLicense, calculateBill, previousReading, sampleData, parseBackup, issueInvoice, setMeter, activeInvoice, invoiceFigures, recordPayment, undoPayment, voidInvoice, type DormData, type Room } from './dorm';
function room(data: DormData, i: number): Room { const r = data.rooms[i]; if (!r) throw new Error('Missing fixture'); return r; }
function inv(data: DormData, r: Room, m = '2026-11') { const x = activeInvoice(data, r.id, m); if (!x) throw new Error('no invoice'); return x; }
function fresh() { let d = emptyData(); d.pro = true; d.rooms = [{ id: 'a', number: '101', tenant: 'สมชาย', rent: 300000, water: 100, electric: 1000 }]; d.settings.common = 10000; d = setMeter(d, room(d, 0), '2026-11', 'water', 110); d = setMeter(d, room(d, 0), '2026-11', 'electric', 1100); return d; }
describe('กฎการคำนวณหอพัก', () => {
  it('คำนวณเป็นสตางค์อย่างแม่นยำ', () => { expect(toSatang('0.29')).toBe(29); expect(toSatang('3500.50')).toBe(350050); expect(() => toSatang('1.001')).toThrow(); });
  it('ฟรี 5 ห้อง และโปร 100 ห้อง', () => { expect(roomLimit(false)).toBe(5); expect(roomLimit(true)).toBe(100); });
  it('ตรวจรหัสออฟไลน์ที่กำหนด', () => { expect(validLicense('DORM2026-PRO')).toBe(true); expect(validLicense('WRONG')).toBe(false); });
  it('ข้อมูลตัวอย่างมี 10 ห้องและ 10 บิล', () => { const d = sampleData('2026-11'); expect(d.rooms).toHaveLength(10); expect(d.invoices).toHaveLength(10); });
  it('ดึงเลขมิเตอร์จากบิลเดือนก่อนและไม่ดึงอนาคต', () => { const d = sampleData('2026-10'); const r = room(d, 0); expect(previousReading(d, r, '2026-11').water).toBe(r.water + 5); expect(previousReading(d, r, '2026-09').water).toBe(r.water); });
  it('แจ้งเลขมิเตอร์ลดลงและไม่ยอมออกบิล', () => { let d = fresh(); d = setMeter(d, room(d, 0), '2026-11', 'water', 99); expect(calculateBill(d, room(d, 0), '2026-11').valid).toBe(false); expect(() => issueInvoice(d, room(d, 0), '2026-11')).toThrow(); });
  it('รวมค่าเช่า น้ำ ไฟ ส่วนกลางเป็นสตางค์', () => { const d = sampleData('2026-11'); expect(inv(d, room(d, 0)).total).toBe(441000); });
  it('ปฏิเสธข้อมูลกู้คืนผิดรูปแบบ', () => { expect(() => parseBackup({ version: 1 })).toThrow(); expect(parseBackup(emptyData()).rooms).toEqual([]); });
});
describe('บิลที่ออกแล้วต้องคงที่', () => {
  // rent 3000 + water 10×18 + electric 100×8 + common 100 = 4080 baht
  it('ยอดไม่เปลี่ยนเมื่อแก้ค่าเช่า อัตรา กำหนดชำระ หรือชื่อผู้เช่า', () => {
    let d = issueInvoice(fresh(), room(fresh(), 0), '2026-11'); const before = inv(d, room(d, 0));
    expect(before.total).toBe(408000);
    d = { ...d, rooms: [{ ...room(d, 0), rent: 999900, tenant: 'คนใหม่' }], settings: { ...d.settings, waterRate: 5000, electricRate: 5000, common: 0, dueDay: 20 } };
    const after = inv(d, room(d, 0));
    expect(after.total).toBe(408000); expect(after.tenant).toBe('สมชาย'); expect(after.dueDate).toBe(before.dueDate); expect(invoiceFigures(after, new Date(2026, 11, 1)).grandTotal).toBe(408000);
  });
  it('ห้ามแก้มิเตอร์หลังออกบิล', () => { const d = issueInvoice(fresh(), room(fresh(), 0), '2026-11'); expect(() => setMeter(d, room(d, 0), '2026-11', 'water', 120)).toThrow(); });
  it('ห้ามออกบิลซ้ำห้องและเดือนเดียวกัน', () => { const d = issueInvoice(fresh(), room(fresh(), 0), '2026-11'); expect(() => issueInvoice(d, room(d, 0), '2026-11')).toThrow(); });
  it('ยกเลิกแล้วออกใหม่ เก็บบิลเดิมพร้อมเหตุผล', () => {
    let d = issueInvoice(fresh(), room(fresh(), 0), '2026-11'); const old = inv(d, room(d, 0));
    expect(() => voidInvoice(d, old.id, ' ')).toThrow();
    d = voidInvoice(d, old.id, 'จดมิเตอร์ผิด'); d = setMeter(d, room(d, 0), '2026-11', 'water', 120); d = issueInvoice(d, room(d, 0), '2026-11', new Date(), old.id);
    const next = inv(d, room(d, 0));
    expect(next.total).toBe(426000); expect(next.replaces).toBe(old.id);
    const kept = d.invoices.find(i => i.id === old.id); expect(kept?.status).toBe('void'); expect(kept?.voidReason).toBe('จดมิเตอร์ผิด'); expect(kept?.total).toBe(408000);
  });
  it('รับชำระบันทึกวันที่จริง ไม่เปลี่ยนยอด และยกเลิกต้องมีเหตุผล', () => {
    let d = issueInvoice(fresh(), room(fresh(), 0), '2026-11'); const id = inv(d, room(d, 0)).id;
    d = recordPayment(d, id, new Date(2026, 11, 3)); expect(inv(d, room(d, 0)).paidAt).toBe(new Date(2026, 11, 3).toISOString()); expect(inv(d, room(d, 0)).total).toBe(408000);
    expect(() => recordPayment(d, id, new Date())).toThrow(); expect(() => undoPayment(d, id, '')).toThrow();
    d = undoPayment(d, id, 'โอนผิดห้อง'); expect(inv(d, room(d, 0)).paidAt).toBeUndefined(); expect(inv(d, room(d, 0)).history.map(h => h.action)).toEqual(['issued', 'paid', 'payment_undone']);
  });
  it('ค่าปรับรายวันแยกจากยอดบิลเดิม และหยุดนับเมื่อชำระ', () => {
    let d = fresh(); d.settings.fine = 2000; d = issueInvoice(d, room(d, 0), '2026-11'); // due 5 Dec
    d.settings.fine = 99999; const x = inv(d, room(d, 0)); const f = invoiceFigures(x, new Date(2026, 11, 8));
    expect(f.total).toBe(408000); expect(f.lateFee).toBe(6000); expect(f.status).toBe('overdue');
    d = recordPayment(d, x.id, new Date(2026, 11, 6)); expect(invoiceFigures(inv(d, room(d, 0)), new Date(2027, 0, 30)).lateFee).toBe(2000);
  });
  it('ค่าปรับเหมาจ่ายครั้งเดียว', () => { let d = fresh(); d.settings.fine = 10000; d.settings.fineMode = 'flat'; d = issueInvoice(d, room(d, 0), '2026-11'); expect(invoiceFigures(inv(d, room(d, 0)), new Date(2026, 11, 20)).lateFee).toBe(10000); });
  it('แปลงข้อมูลเก่าเป็นบิล พร้อมระบุว่าเป็นยอดที่สร้างย้อนหลัง', () => {
    const old = { version: 1, pro: true, demo: false, settings: emptyData().settings, rooms: [{ id: 'a', number: '101', tenant: 'x', rent: 300000, water: 100, electric: 1000 }], readings: { '2026-10': { a: { water: 110, electric: 1100, paid: true, paidAt: '2026-11-03T00:00:00.000Z', issued: true } }, '2026-11': { a: { water: 115, electric: 1150, paid: false } } } };
    const d = parseBackup(old);
    expect(d.version).toBe(2); expect(d.invoices).toHaveLength(1);
    const m = d.invoices[0]; expect(m?.legacy).toBe(true); expect(m?.paidAt).toBe('2026-11-03T00:00:00.000Z'); expect(m?.history[0]?.action).toBe('migrated');
    expect(previousReading(d, room(d, 0), '2026-11').water).toBe(110);
  });
});
