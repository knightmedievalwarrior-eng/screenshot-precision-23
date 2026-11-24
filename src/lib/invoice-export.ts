import { downloadBlob } from './dorm';

// A separate, script-free document prevents app styles and resources from delaying capture.
export async function exportInvoicePng(source: HTMLElement, filename: string) {
  const { default: html2canvas } = await import('html2canvas');
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.ceil(source.getBoundingClientRect().width)}px;height:1200px;border:0;`;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error('Cannot prepare invoice');
    doc.open(); doc.write('<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body></body></html>'); doc.close();
    const clone = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
    const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
    const pixel = document.createElement('canvas'); pixel.width = pixel.height = 1;
    const context = pixel.getContext('2d');
    function rgb(color: string) {
      if(!context) return color;
      context.clearRect(0,0,1,1); context.fillStyle=color; context.fillRect(0,0,1,1);
      const [r=0,g=0,b=0,a=255]=context.getImageData(0,0,1,1).data;
      return `rgba(${r},${g},${b},${a/255})`;
    }
    originals.forEach((el,index)=>{
      const copy=copies[index]; if(!copy) return;
      const computed=getComputedStyle(el);
      for(const prop of Array.from(computed)) {
        if(prop.startsWith('--')||prop.startsWith('animation')||prop.startsWith('transition'))continue;
        let value=computed.getPropertyValue(prop);
        if(prop==='color'||prop==='background-color'||prop.endsWith('-color')) value=rgb(value);
        copy.style.setProperty(prop,value);
      }
      copy.style.boxShadow='none'; copy.style.animation='none';
    });
    doc.body.style.margin='0'; doc.body.appendChild(clone);
    await Promise.all(Array.from(clone.querySelectorAll('img')).map(img=>img.decode().catch(()=>{})));
    const canvas=await html2canvas(clone,{scale:2,backgroundColor:null,logging:false});
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('PNG export failed');
    downloadBlob(blob,filename);
  } finally { frame.remove(); }
}