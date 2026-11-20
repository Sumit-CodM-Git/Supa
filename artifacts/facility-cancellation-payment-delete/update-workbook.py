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
   replacements={
    'Payment deletion verified with rollback-only fixtures against the live database; HTTP cancellation not retested for this revision.':'2026-11-19: live HTTP cancel_booking and abort_pending_booking verified to delete unpaid booking/payment records; same slot rebooking passed. Paid/uploaded retention and cancelled/rejected-without-proof deletion verified with rollback database fixtures.',
    'Once proof is uploaded or payment is submitted/successful/paid, retain booking and payment records marked cancelled and release the slot.':'Once proof is uploaded or payment is submitted/successful/paid, retain booking and payment records marked cancelled and release the slot. Cancelled or rejected status alone is not payment evidence; without uploaded proof these records are deleted on cancellation.',
    'Your facility booking and linked payment record have been deleted. The slot is now free. Cancellation does not issue a refund.':'Your facility booking has been cancelled and the slot is now free. Unpaid bookings without uploaded payment proof are deleted; submitted or paid bookings are retained as cancelled. Cancellation does not issue a refund.',
    'Your facility booking and linked payment record have been deleted. The slot is now free. Cancellation does not issue a refund.':'Your facility booking has been cancelled and the slot is now free. Unpaid bookings without uploaded payment proof are deleted; submitted or paid bookings are retained as cancelled. Cancellation does not issue a refund.',
    'Cancellation physically deletes the resident-owned SSP_Facility_Booking_Request and linked SSP_Facility_Booking records in one transaction, deletes the linked SSP_Payment record, and releases the slot. Receipt documents remain with their payment reference cleared.': 'Cancellation deletes the booking request, linked booking and payment only when payment is unpaid/pending/waiting_payment and no non-empty receipt object exists in society-documents. Once proof is uploaded or payment is submitted/successful/paid, retain booking and payment records marked cancelled and release the slot. Receipt URL or document metadata alone does not prove upload. Abort rejects uploaded/submitted payments. No refund is issued.',
    'Deployed 2026-11-19; cancellation deletes payment records':'Deployed 2026-11-19; conditional cancellation retains submitted payments',
    'A second cancel of a removed ID returns 404.':'A second cancel of a deleted unpaid booking ID returns 404; retained cancelled bookings remain in history.'}
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
Path('artifacts/facility-cancellation-payment-delete/workbook-verification.json').write_text(json.dumps(report,indent=2));print(report)
