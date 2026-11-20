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

    folder=ROOT/'artifacts/facility-cancel-dispatch'
    deployment=json.loads((folder/'deployment.json').read_text()) if (folder/'deployment.json').exists() else {}
    live=json.loads((folder/'live-result.json').read_text()) if (folder/'live-result.json').exists() else {}
    verified=live.get('passed',False) and 'unexpected_action_response' not in live and len(live.get('cleanup',{}))>=4 and all(live['cleanup'].values())
    note='Action dispatch fix: action values are trimmed and case-insensitive. cancel is an alias for cancel_booking and requires bookingRequestId; it never creates a booking. Unsupported or empty actions return 400 before any database write. book with bookingRequestId returns 400. Omitted action retains legacy inference: bookingRequestId means cancel_booking, otherwise facilityName means book, otherwise list_facilities. Cancellation deletes owned booking/request rows and retains cancelled payment history.'
    matches=[];count=0
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row};first=i==1
            if cells.get('G' if first else 'E')!='resident-facility-booking':continue
            r=row.get('r');request_col='M' if first else 'K';response_col='T' if first else 'R'
            request=cells.get(request_col,'').split('\n\nAction dispatch fix:')[0]+'\n\n'+note
            example={'action':'cancel','societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','residentId':'<RESIDENT_UUID>','bookingRequestId':'<REQUEST_ID_OR_CONFIRMED_FACILITY_BOOKING_ID>'}
            request+='\n\nCancel alias (JSONC; remove comments before sending JSON):\n'+json.dumps(example,indent=2).replace('"action": "cancel",','"action": "cancel", // list_facilities, get_blocked_slots, book, list_bookings, cancel_booking, abort_pending_booking, cancel')
            response=cells.get(response_col,'').split('\n\nInvalid action (JSONC')[0]
            response+='\n\nInvalid action (JSONC; remove comments before sending JSON):\n'+json.dumps({'success':False,'message':'Invalid action. Allowed: list_facilities, get_blocked_slots, book, list_bookings, cancel_booking, abort_pending_booking.'},indent=2)
            status='Deployed ACTIVE version '+str(deployment.get('version')) if deployment.get('version') else 'Deployment pending'
            validation='Live HTTP cancellation, invalid-action no-write checks and same-slot rebooking verified with disposable fixtures.' if verified else 'Live verification pending; local regression tests passed.'
            vals={request_col:request,response_col:response,('Q' if first else 'O'):status,('P' if first else 'N'):validation,('S' if first else 'Q'):'2026-11-18',('U' if first else 'T'):cells.get('U' if first else 'T','').split('\n2026-11-18 dispatch validation:')[0]+'\n2026-11-18 dispatch validation: '+note+' '+status+'. '+validation}
            # Keep all documented action enums consistent with the supported alias.
            for col in ['O','V'] if first else ['M','S']:
                vals[col]=cells.get(col,'').replace('"abort_pending_booking" | "cancel"','"abort_pending_booking"').replace('"abort_pending_booking"','"abort_pending_booking" | "cancel"')
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
            value=text_of(cell);assert len(value.encode('utf-16-le'))//2<=32767
            if cell.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            value=re.sub(r'(?m)(?<=\s)//[^\n]*','',value);end=0
            for m in re.finditer(r'(?m)^\s*\{',value):
                start=value.index('{',m.start())
                if start<end:continue
                _,size=json.JSONDecoder().raw_decode(value[start:]);end=start+size;count+=1
temp.replace(BOOK)
result={'updated_rows':matches,'jsonc_examples_validated':count,'unrelated_parts_preserved':True,'deployment':deployment,'live_verification':verified}
(folder/'workbook-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
