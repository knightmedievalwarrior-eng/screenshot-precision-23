import { useRef, useState } from 'react';
import { Download, Printer, Check, Ban, CircleCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDorm } from './dorm-provider';
import { activeInvoice, calculateBill, invoiceFigures, invoiceNumber, issueInvoice, money, monthLabel, recordPayment, undoPayment, voidInvoice, type DormData, type Room } from '@/lib/dorm';
import { exportInvoicePng } from '@/lib/invoice-export';

const thDate = (d: Date | string) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const actionLabel = { issued: 'ออกบิล', paid: 'บันทึกรับชำระ', payment_undone: 'ยกเลิกการรับชำระ', voided: 'ยกเลิกบิล', migrated: 'แปลงข้อมูลเดิม' };

export function InvoiceDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const { data, setData, month } = useDorm();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [paidDate, setPaidDate] = useState(todayInput);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'none' | 'void' | 'undo'>('none');
  if (!room) return null;
  const inv = activeInvoice(data, room.id, month);
  const voided = data.invoices.filter(i => i.roomId === room.id && i.month === month && i.status === 'void');
  const draft = calculateBill(data, room, month);
  const s = data.settings;
  const f = inv ? invoiceFigures(inv) : null;
  const view = inv && f ? {
    name: inv.dormName, address: inv.dormAddress, phone: inv.dormPhone, bank: inv.bank, no: invoiceNumber(inv, data.invoices), room: inv.roomNumber, tenant: inv.tenant, due: f.due, rent: inv.rent,
    wPrev: inv.waterPrev, wCur: inv.waterCur, w: f.water, wRate: inv.waterRate, wCost: f.waterCost, ePrev: inv.electricPrev, eCur: inv.electricCur, e: f.electric, eRate: inv.electricRate, eCost: f.electricCost, common: inv.common, total: inv.total,
  } : {
    name: s.name, address: s.address, phone: s.phone, bank: s.bank, no: `${month.replace('-', '')}-${room.number}`, room: room.number, tenant: room.tenant, due: draft.due, rent: room.rent,
    wPrev: draft.previous.water, wCur: draft.current.water, w: draft.water, wRate: s.waterRate, wCost: draft.waterCost, ePrev: draft.previous.electric, eCur: draft.current.electric, e: draft.electric, eRate: s.electricRate, eCost: draft.electricCost, common: s.common, total: draft.total,
  };
  const canExport = !!inv || draft.valid;
  function run(fn: (d: DormData) => DormData, ok: string) { try { setData(fn(data)); toast.success(ok); setMode('none'); setReason(''); } catch (e) { toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ'); } }
  async function png() { if (!ref.current) return; setBusy(true); try { await exportInvoicePng(ref.current, `ใบแจ้งหนี้-${view.no}.png`); toast.success('ดาวน์โหลดใบแจ้งหนี้แล้ว'); } catch { toast.error('บันทึกรูปไม่สำเร็จ กรุณาลองอีกครั้ง'); } finally { setBusy(false); } }
  function issue() {
    if (!room || data.demo) return;
    if (!data.pro && data.rooms.findIndex(r => r.id === room.id) >= 5) { toast.error('รุ่นฟรีออกบิลได้ 5 ห้องแรก'); return; }
    run(d => issueInvoice(d, room, month, new Date(), voided.at(-1)?.id), 'บันทึกใบแจ้งหนี้แล้ว ยอดในบิลนี้จะไม่เปลี่ยนตามการตั้งค่าภายหลัง');
  }
  return <Dialog open={!!room} onOpenChange={v => { if (!v) { setMode('none'); onClose(); } }}><DialogContent className="modal-scroll">
    <DialogTitle>ใบแจ้งหนี้ ห้อง {view.room}</DialogTitle>
    <DialogDescription>ประจำเดือน {monthLabel(month)} · {inv ? `ออกบิลเมื่อ ${thDate(inv.issuedAt)}` : 'ฉบับร่าง ยังไม่ได้บันทึก'}</DialogDescription>
    {inv?.legacy && <p className="field-error">บิลนี้แปลงจากข้อมูลเก่า ยอดคำนวณจากอัตรา ณ วันที่แปลง อาจไม่ตรงกับบิลที่ส่งให้ผู้เช่าจริง</p>}
    <div ref={ref} className="invoice-paper">
      <div className="invoice-header"><div><h2>{view.name}</h2><p>{view.address}<br />{view.phone && `โทร. ${view.phone}`}</p></div><div><strong>ใบแจ้งหนี้</strong><p>เลขที่ {view.no}<br />{monthLabel(month)}</p></div></div>
      <div className="invoice-info"><div><strong>ห้อง {view.room}</strong><br />ผู้เช่า: {view.tenant || '—'}</div><div>กำหนดชำระ<br /><strong>{thDate(view.due)}</strong></div></div>
      <table className="invoice-table"><thead><tr><th>รายการ</th><th>รายละเอียด</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody>
        <tr><td>ค่าเช่าห้องพัก</td><td>ประจำเดือน</td><td>{money(view.rent)}</td></tr>
        <tr><td>ค่าน้ำ</td><td>{view.wPrev} → {view.wCur}<br />{view.w} หน่วย × {money(view.wRate)}</td><td>{money(view.wCost)}</td></tr>
        <tr><td>ค่าไฟฟ้า</td><td>{view.ePrev} → {view.eCur}<br />{view.e} หน่วย × {money(view.eRate)}</td><td>{money(view.eCost)}</td></tr>
        <tr><td>ค่าส่วนกลาง / ขยะ</td><td>ประจำเดือน</td><td>{money(view.common)}</td></tr>
      </tbody></table>
      <div className="invoice-total"><span>ยอดชำระตามใบแจ้งหนี้</span><span>{money(view.total)} บาท</span></div>
      {f && f.lateFee > 0 && <table className="invoice-table"><tbody><tr><td>ค่าปรับล่าช้า (คิดเพิ่มหลังครบกำหนด)</td><td>{f.days} วัน{inv?.fineMode === 'daily' ? ` × ${money(inv.fine)}` : ' (เหมาจ่าย)'}</td><td>{money(f.lateFee)}</td></tr><tr><td><strong>รวมที่ต้องชำระ{inv?.paidAt ? '' : ' ณ วันนี้'}</strong></td><td></td><td><strong>{money(f.grandTotal)}</strong></td></tr></tbody></table>}
      <div className="invoice-payment"><strong>{inv?.paidAt ? `ชำระเงินแล้ว เมื่อ ${thDate(inv.paidAt)}` : 'ช่องทางชำระเงิน'}</strong>{s.qr && !inv?.paidAt && <img src={s.qr} alt="คิวอาร์โค้ดรับชำระเงิน" />}<p>{view.bank || 'ติดต่อเจ้าของหอพักเพื่อชำระเงิน'}</p><p>ขอบคุณที่ไว้วางใจ {view.name}</p>{data.demo && <p>ข้อมูลตัวอย่าง • ไม่ใช่ใบแจ้งหนี้จริง</p>}{!inv && <p>ฉบับร่าง • ยังไม่ได้ออกบิล</p>}</div>
    </div>
    {!inv && !draft.valid && <p className="field-error">เลขมิเตอร์ล่าสุดต้องไม่น้อยกว่าครั้งก่อน</p>}
    <div className="invoice-tools">
      <Button variant="outline" disabled={busy || !canExport} onClick={png}><Download />{busy ? 'กำลังบันทึก…' : 'ดาวน์โหลดรูป PNG'}</Button>
      <Button variant="outline" onClick={() => window.print()} disabled={!canExport}><Printer />พิมพ์ / PDF</Button>
      {!inv && <Button onClick={issue} disabled={!draft.valid || data.demo}><Check />{voided.length ? 'ออกบิลใหม่' : 'บันทึกใบแจ้งหนี้'}</Button>}
    </div>
    {inv && !data.demo && <div className="invoice-tools">
      {!inv.paidAt && <><label className="search-field"><span>วันที่รับเงิน</span><input type="date" aria-label="วันที่รับเงิน" value={paidDate} max={todayInput()} onChange={e => setPaidDate(e.target.value)} /></label>
        <Button onClick={() => { const [y, m, d] = paidDate.split('-').map(Number); if (!y || !m || !d) { toast.error('กรุณาเลือกวันที่รับเงิน'); return; } run(x => recordPayment(x, inv.id, new Date(y, m - 1, d)), 'บันทึกรับชำระแล้ว'); }}><CircleCheck />บันทึกรับชำระ</Button>
        <Button variant="outline" onClick={() => setMode('void')}><Ban />ยกเลิก / ออกใหม่</Button></>}
      {inv.paidAt && <Button variant="outline" onClick={() => setMode('undo')}><Undo2 />ยกเลิกการรับชำระ</Button>}
    </div>}
    {inv && mode !== 'none' && <div className="invoice-tools"><input className="meter-input" style={{ flex: 1, width: 'auto' }} aria-label="เหตุผล" placeholder={mode === 'void' ? 'เหตุผลที่ยกเลิกบิล เช่น จดมิเตอร์ผิด' : 'เหตุผลที่ยกเลิกการรับชำระ'} value={reason} onChange={e => setReason(e.target.value)} />
      <Button variant="destructive" onClick={() => run(x => mode === 'void' ? voidInvoice(x, inv.id, reason) : undoPayment(x, inv.id, reason), mode === 'void' ? 'ยกเลิกบิลแล้ว แก้มิเตอร์แล้วออกบิลใหม่ได้' : 'ยกเลิกการรับชำระแล้ว')}>ยืนยัน</Button>
      <Button variant="ghost" onClick={() => setMode('none')}>ปิด</Button></div>}
    {(inv || voided.length > 0) && <div className="meter-previous"><strong>ประวัติ</strong>{[...(inv ? [inv] : []), ...voided].flatMap(i => i.history.map(h => ({ h, no: invoiceNumber(i, data.invoices) }))).sort((a, b) => a.h.at.localeCompare(b.h.at)).map(({ h, no }, k) => <div key={k}>{new Date(h.at).toLocaleString('th-TH')} · {no} · {actionLabel[h.action]}{h.note ? ` — ${h.note}` : ''}</div>)}</div>}
  </DialogContent></Dialog>;
}
