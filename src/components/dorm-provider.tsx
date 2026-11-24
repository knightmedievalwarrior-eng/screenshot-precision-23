import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyData, parseBackup, STORAGE_KEY, type DormData } from '@/lib/dorm';
type Context = { data: DormData; setData: (data: DormData | ((old: DormData) => DormData)) => void; month: string; setMonth: (month: string) => void; ready: boolean; storageError: string };
const DormContext = createContext<Context | null>(null);
export function DormProvider({children}: {children: ReactNode}) {
  const [data, updateData] = useState<DormData>(emptyData);
  const corrupt=useRef(false);
  const setData:Context['setData']=(next)=>{corrupt.current=false;setError('');updateData(next);};
  const [month, setMonth] = useState('2026-11');
  const [ready, setReady] = useState(false);
  const [storageError, setError] = useState('');
  useEffect(() => { const now = new Date(); setMonth(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`); try { const saved = localStorage.getItem(STORAGE_KEY); if(saved) updateData(parseBackup(JSON.parse(saved))); } catch { corrupt.current=true;setError('อ่านข้อมูลในเครื่องไม่ได้ กรุณากู้คืนไฟล์สำรองก่อนบันทึกข้อมูลใหม่'); } setReady(true); }, []);
  useEffect(() => { if(!ready||corrupt.current) return; try { localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); } catch { setError('บันทึกในเครื่องไม่สำเร็จ พื้นที่อาจเต็ม กรุณาสำรองข้อมูลทันที'); } }, [data,ready]);
  return <DormContext.Provider value={{data,setData,month,setMonth,ready,storageError}}>{children}</DormContext.Provider>;
}
export function useDorm() { const ctx=useContext(DormContext); if(!ctx) throw new Error('DormProvider required'); return ctx; }