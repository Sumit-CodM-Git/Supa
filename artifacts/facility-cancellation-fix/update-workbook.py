from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-facility-booking','facility-console'}
with zipfile.ZipFile(BOOK) as src:
    infos=src.infolist()
    original={i.filename:src.read(i.filename) for i in infos}
    changed={}
    strings=[''.join(si.itertext()) for si in ET.fromstring(original['xl/sharedStrings.xml']).findall('m:si',NS)]
    def text_of(cell):
        if cell is None:
            return ''
        if cell.get('t') == 's':
            return strings[int(cell.find('m:v', NS).text)]
        inline = cell.find('m:is', NS)
        if inline is not None:
            return ''.join(inline.itertext())
        value = cell.find('m:v', NS)
        return value.text if value is not None else ''

    def replace_cell(xml, ref, value):
        assert len(value.encode('utf-16-le'))//2<=32767
        prefix='ns0:' if '<ns0:worksheet' in xml else ''
        tag=prefix+'c'
        match=re.search(r'<'+tag+r'\b[^>]*\br="'+re.escape(ref)+r'"[^>]*(?:/>|>.*?</'+tag+r'>)',xml,re.S)
        assert match,ref
        style=re.search(r'\bs="([^" ]+)"',match.group())
        attr=f' s="{style.group(1)}"' if style else ''
        cell=f'<{tag} r="{ref}"{attr} t="inlineStr"><{prefix}is><{prefix}t xml:space="preserve">{escape(value)}</{prefix}t></{prefix}is></{tag}>'
        return xml[:match.start()]+cell+xml[match.end():]

    matches=[]
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS:continue
            r=row.get('r')
            note = ('cancel_booking accepts bookingRequestId as a request ID or confirmed facilityBookingId returned by resident lists. Cancellation atomically sets linked request status, booking_status, approval_status and payment_status to cancelled. Repeated cancellation succeeds. Missing or foreign IDs return 404; database errors return 500 and roll back all writes. Payment cancellation does not transfer a refund; contact admin for refunds. abort_pending_booking remains restricted to unpaid reservations.' if ep=='resident-facility-booking' else 'Facilities returned by FETCH_FACILITIES and FETCH_SCHEDULE are ordered by created_at descending, null dates last. FETCH_MY_BOOKINGS is sorted by creation date descending across requests and confirmed bookings. Hourly slots remain chronological.')
            request_col='M' if first else 'K';response_col='T' if first else 'R';audit_col='U' if first else 'T'
            request=cells.get(request_col,'')+'\n\n2026-11-18 cancellation/order update: '+note
            response=cells.get(response_col,'')
            if ep=='resident-facility-booking':
                req={'action':'cancel_booking','societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','bookingRequestId':'<REQUEST_ID_OR_CONFIRMED_FACILITY_BOOKING_ID>'}
                request+='\n\nCancellation (JSONC; remove comments before sending JSON):\n'+json.dumps(req,indent=2).replace('"action": "cancel_booking",','"action": "cancel_booking", // list_facilities, get_blocked_slots, book, list_bookings, cancel_booking, abort_pending_booking')
                example={'success':True,'data':{'action':'cancel_booking','facilityBooking':{'requestId':'<REQUEST_ID_OR_CONFIRMED_FACILITY_BOOKING_ID>','status':'cancelled','message':'Your facility booking has been cancelled successfully. Please contact admin for refunds if already paid.'},'availableFacilities':None,'bookings':None,'blockedSlots':None,'uploadUrl':None,'documentId':None,'paymentId':None}}
                response+='\n\nCancellation success (JSONC; remove comments before sending JSON):\n'+json.dumps(example,indent=2)
            vals={request_col:request,response_col:response,('S' if first else 'Q'):'2026-11-18',audit_col:cells.get(audit_col,'')+'\n2026-11-18: '+note+' Local mocked handler tests passed. Migration 20261118160000 and function changes not deployed; live verification not performed.'}
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append([i,r,ep])
        changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    count=0
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    for i,r,ep in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for cell in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            value=text_of(cell);assert len(value.encode('utf-16-le'))//2<=32767
            if cell.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            value=re.sub(r'(?m)(?<=\s)//[^\n]*','',value);end=0
            for match in re.finditer(r'(?m)^\s*\{',value):
                start=value.index('{',match.start())
                if start<end:continue
                _,size=json.JSONDecoder().raw_decode(value[start:]);end=start+size;count+=1
    assert count>0
temp.replace(BOOK)
report={'updated_rows':matches,'validated_json_examples':count,'unrelated_parts_preserved':True,'deployed':False,'live_tested':False}
(ROOT/'artifacts/facility-cancellation-fix/workbook-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
