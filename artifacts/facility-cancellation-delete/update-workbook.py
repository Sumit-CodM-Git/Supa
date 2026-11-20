from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-facility-booking'}
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

    report_path=ROOT/'artifacts/facility-cancellation-delete/deployment.json'
    deployment=json.loads(report_path.read_text()) if report_path.exists() else {}
    live_path=ROOT/'artifacts/facility-cancellation-delete/live-result.json'
    live=json.loads(live_path.read_text()) if live_path.exists() else {}
    NOTE='Cancellation physically deletes the resident-owned SSP_Facility_Booking_Request and linked SSP_Facility_Booking records in one transaction, marks the linked SSP_Payment as cancelled, and releases the slot. Payment ledger and receipt documents remain. cancel_booking accepts a request ID or confirmed facilityBookingId in bookingRequestId. abort_pending_booking accepts a request ID and only unpaid/pending/waiting_payment payments; the database rechecks this under lock. Deleted bookings disappear from resident and admin booking lists. A second cancel of a removed ID returns 404. Cancellation does not issue a refund.'
    matches=[];example_count=0
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row};first=i==1
            if cells.get('G' if first else 'E','') not in EPS:continue
            r=row.get('r');request_col='M' if first else 'K';response_col='T' if first else 'R'
            response=cells.get(response_col,'').split('\n\ncancel_booking deletion success')[0]
            # Preserve all operation examples, update only cancellation response messages.
            response=response.replace('Your facility booking has been cancelled successfully. Please contact admin for refunds if already paid.','Your facility booking has been cancelled and removed. The slot is now free. Please contact admin for refunds if already paid.').replace('Booking aborted and the slot released. You can book again anytime.','Booking cancelled and removed, and the slot released. You can book again anytime.')
            for action in ['cancel_booking','abort_pending_booking']:
                if action=='cancel_booking':
                    fb={'requestId':'<REQUEST_ID_OR_CONFIRMED_FACILITY_BOOKING_ID>','status':'cancelled','message':'Your facility booking has been cancelled and removed. The slot is now free. Please contact admin for refunds if already paid.'}
                else:
                    fb={'requestId':'<REQUEST_UUID>','aborted':True,'partial':False,'message':'Booking cancelled and removed, and the slot released. You can book again anytime.'}
                example={'success':True,'data':{'action':action,'facilityBooking':fb,'availableFacilities':None,'bookings':None,'blockedSlots':None,'uploadUrl':None,'documentId':None,'paymentId':None}}
                response+='\n\n'+action+' deletion success (JSONC; remove comments before sending JSON):\n'+json.dumps(example,indent=2).replace('"action": "'+action+'",','"action": "'+action+'", // list_facilities, get_blocked_slots, book, list_bookings, cancel_booking, abort_pending_booking')
            request=cells.get(request_col,'').split('\n\nCancellation deletion behavior (2026-11-18):')[0]+'\n\nCancellation deletion behavior (2026-11-18): '+NOTE
            curl=cells.get('R' if first else 'P','').split('\n\nCancel and remove booking:')[0]+'\n\nCancel and remove booking:\ncurl --request POST https://isrqhkshygauaehwfycw.supabase.co/functions/v1/resident-facility-booking \\\n  --header \'Content-Type: application/json\' \\\n  --header \'Authorization: Bearer <JWT_TOKEN>\' \\\n  --data-raw \'{"action":"cancel_booking","societyRegistrationNumber":"<SOCIETY_REGISTRATION_NUMBER>","residentId":"<RESIDENT_UUID>","bookingRequestId":"<REQUEST_ID_OR_CONFIRMED_FACILITY_BOOKING_ID>"}\''
            status=('Deployed ACTIVE version '+str(deployment['version']) if deployment.get('version') else 'Source updated; deployment pending')
            evidence='Local handler regression tests and rollback-only database tests passed. '+('Live cancellation API and row deletion verified on disposable fixtures.' if live.get('passed') else 'Live HTTP verification pending.')
            vals={('R' if first else 'P'):curl,request_col:request,response_col:response,('K' if first else 'I'):cells.get('K' if first else 'I','').split('\n\nCancellation physically deletes')[0]+'\n\n'+NOTE,('N' if first else 'L'):cells.get('N' if first else 'L','').replace('cancel/abort require bookingRequestId UUID','cancel requires bookingRequestId as request ID or confirmed facilityBookingId; abort requires request ID'),('P' if first else 'N'):evidence,('Q' if first else 'O'):status,('R' if first else 'P'):curl,('S' if first else 'Q'):'2026-11-18',('U' if first else 'T'):cells.get('U' if first else 'T','').split('\n2026-11-18 physical')[0]+'\n2026-11-18 physical cancellation deletion: '+NOTE+' '+status+'. '+evidence}
            for col,val in vals.items():xml=replace_cell(xml,col+r,val)
            matches.append([i,r])
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert matches

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    for i,r in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for cell in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            val=text_of(cell);assert len(val.encode('utf-16-le'))//2<=32767
            if cell.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            val=re.sub(r'(?m)(?<=\s)//[^\n]*','',val);end=0
            for m in re.finditer(r'(?m)^\s*\{',val):
                start=val.index('{',m.start())
                if start<end:continue
                _,size=json.JSONDecoder().raw_decode(val[start:]);end=start+size;example_count+=1
temp.replace(BOOK)
result={'updated_rows':matches,'jsonc_examples_validated':example_count,'unrelated_parts_preserved':True,'deployment':deployment,'live_verification':live.get('passed',False)}
(ROOT/'artifacts/facility-cancellation-delete/workbook-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
