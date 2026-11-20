from pathlib import Path
import zipfile, re, json, xml.etree.ElementTree as E
from xml.sax.saxutils import escape
p=Path('Society Sync Pro 2.0 - APIs - Updated.xlsx'); ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p) as z: infos=z.infolist(); data={i.filename:z.read(i.filename) for i in infos}
ss=[''.join(x.itertext()) for x in E.fromstring(data['xl/sharedStrings.xml']).findall('m:si',ns)]
def value(c):
 if c.get('t')=='s':return ss[int(c.find('m:v',ns).text)]
 return ''.join(c.find('m:is',ns).itertext()) if c.find('m:is',ns) is not None else (c.findtext('m:v','',ns))
updated={}; rows=[]; count=0
for i in range(1,4):
 key=f'xl/worksheets/sheet{i}.xml'; xml=data[key].decode(); root=E.fromstring(xml)
 for row in root.findall('m:sheetData/m:row',ns):
  if not any(value(c)=='resident-facility-booking' for c in row):continue
  rows.append([i,row.get('r')])
  for c in row:
   old=value(c); new=old
   replacements={'Cancellation deletes the booking request, linked booking and payment only when payment is unpaid/pending/waiting_payment and no non-empty receipt object exists in society-documents. Once proof is uploaded or payment is submitted/successful/paid, retain booking and payment records marked cancelled and release the slot. Receipt URL or document metadata alone does not prove upload. Abort rejects uploaded/submitted payments. No refund is issued.': 'All resident cancellations retain the booking request, linked confirmed booking and payment records marked cancelled, regardless of whether payment is unpaid or an image was uploaded. Cancellation releases the slot. Receipt documents remain linked. abort_pending_booking retains cancelled records too, but still rejects uploaded/submitted payments. No refund is issued. Repeated cancel_booking calls succeed for retained records.', 'Your facility booking has been cancelled and the slot is now free. Unpaid bookings without uploaded payment proof are deleted; submitted or paid bookings are retained as cancelled. Cancellation does not issue a refund.': 'Your facility booking has been cancelled and the slot is now free. Bookings without uploaded payment proof are deleted; submitted or paid bookings are retained as cancelled. Cancellation does not issue a refund.', 'Booking and linked payment record deleted, and the slot released. You can book again anytime.': 'Booking and linked payment record marked cancelled, and the slot released. You can book again anytime.', 'A second cancel of a deleted unpaid booking ID returns 404; retained cancelled bookings remain in history.': 'Repeated cancellation retains cancelled history and returns success.', 'Deleted bookings disappear from resident and admin booking lists.': 'Cancelled bookings remain in booking history and do not block the slot.', 'Deployed 2026-11-19; conditional cancellation retains submitted payments': 'Deployed 2026-11-19; all cancellations retain cancelled records', '2026-11-19: live HTTP cancel_booking and abort_pending_booking verified to delete unpaid booking/payment records; same slot rebooking passed. Paid/uploaded retention and cancelled/rejected-without-proof deletion verified with rollback database fixtures.': 'Universal cancellation retention: local regression and rollback database checks; live HTTP verification tracked in artifacts/facility-cancellation-retain-all/live-result.json.'}
   for a,b in replacements.items():new=new.replace(a,b)
   if new==old:continue
   assert len(new.encode('utf-16-le'))//2<=32767
   ref=c.get('r'); match=re.search(r'<(?:\w+:)?c\b[^>]*\br="'+ref+r'"[^>]*(?:/>|>.*?</(?:\w+:)?c>)',xml,re.S);assert match
   tag=match.group().split()[0][1:]; prefix=tag[:-1]; style=c.get('s'); attrs=f' s="{style}"' if style else ''
   replacement=f'<{tag} r="{ref}"{attrs} t="inlineStr"><{prefix}is><{prefix}t xml:space="preserve">{escape(new)}</{prefix}t></{prefix}is></{tag}>'
   xml=xml[:match.start()]+replacement+xml[match.end():]
   if re.sub(r'\d','',ref) in ['K','R']:
    cleaned=re.sub(r'(?m)(?<=\s)//[^\n]*','',new);end=0
    for m in re.finditer(r'(?m)^\s*\{',cleaned):
     start=cleaned.index('{',m.start())
     if start<end:continue
     _,size=json.JSONDecoder().raw_decode(cleaned[start:]);end=start+size;count+=1
  updated[key]=xml.encode()
assert rows
q=p.with_suffix('.pending.xlsx')
with zipfile.ZipFile(q,'w',zipfile.ZIP_DEFLATED) as z:
 for info in infos:z.writestr(info,updated.get(info.filename,data[info.filename]))
with zipfile.ZipFile(q) as z:
 assert z.testzip() is None
 for k,v in data.items():
  if k.endswith('.xml'):E.fromstring(z.read(k))
  if k not in updated:assert z.read(k)==v
q.replace(p)
report={'rows':rows,'examples_validated':count,'unrelated_parts_preserved':True}
Path('artifacts/facility-cancellation-retain-all/workbook-verification.json').write_text(json.dumps(report,indent=2));print(report)
