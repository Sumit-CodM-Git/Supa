const ts=require('/private/tmp/ssp-api-workbook-audit/node_modules/typescript');
const fs=require('fs'),path=require('path');
const columns=new Set('society_id created_at active address_line1 address_line2 amenities city country covered_parking description open_parking operation_start_day parking_slot postal_code registration_number society_name state total_unit year_built email phone_number logo_url updated_at'.split(' '));
const direct=[],joins=[],invalid=[],queryFiles=new Set();let parsed=0;
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.ts')?[path.join(dir,e.name)]:[])}
for(const file of files('supabase/functions')){
 const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);parsed++;
 const defs=new Map();function collect(n){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer)defs.set(n.name.text,n.initializer);ts.forEachChild(n,collect)}collect(sf);
 function constant(n,depth=0){if(!n||depth>8)return null;if(ts.isStringLiteralLike(n))return n.text;if(ts.isIdentifier(n)&&defs.has(n.text))return constant(defs.get(n.text),depth+1);if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=constant(n.left,depth+1),b=constant(n.right,depth+1);return a!==null&&b!==null?a+b:null}return null}
 function from(n,seen=new Set()){if(!n||seen.has(n))return null;seen.add(n);if(ts.isCallExpression(n)){if(ts.isPropertyAccessExpression(n.expression)){if(n.expression.name.text==='from')return constant(n.arguments[0]);return from(n.expression.expression,seen)}}if(ts.isIdentifier(n)&&defs.has(n.text))return from(defs.get(n.text),seen);return null}
 function split(select){const parts=[];let i=0,start=0,level=0;for(;i<select.length;i++){if(select[i]==='(')level++;if(select[i]===')')level--;if(select[i]===','&&!level){parts.push(select.slice(start,i).trim());start=i+1}}parts.push(select.slice(start).trim());return parts}
 function check(select,where){for(const part of split(select)){if(!part||part==='*'||part.includes('('))continue;const raw=part.split(':').at(-1).split('::')[0].trim();if(!columns.has(raw))invalid.push({...where,column:raw})}}
 function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)){
  const method=n.expression.name.text,table=from(n.expression.expression),line=sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1;
  if(table==='SSP_Society'){
   queryFiles.add(file);const value=constant(n.arguments[0]);
   if(['select','eq','neq','ilike','like','order','in','is','gt','lt','gte','lte','contains'].includes(method)&&value!==null){const row={file,line,method,fields:value};direct.push(row);if(method==='select')check(value,row);else if(!columns.has(value))invalid.push({...row,column:value})}
   if(['insert','update','upsert'].includes(method)&&n.arguments[0]&&ts.isObjectLiteralExpression(n.arguments[0]))for(const p of n.arguments[0].properties){if(ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p)){const key=p.name.getText(sf).replace(/^['"]|['"]$/g,'');if(!columns.has(key))invalid.push({file,line,method,column:key})}}
  }
  if(method==='select'){
   const value=constant(n.arguments[0]);if(value){const re=/(?:\bSSP_Society(?:![\w]+)*|\bsociety:society(?:![\w]+)*)\s*\(/g;let m;while((m=re.exec(value))){const start=m.index+m[0].length;let end=start,level=1;while(end<value.length&&level){if(value[end]==='(')level++;if(value[end]===')')level--;end++}const selected=value.slice(start,end-1);const row={file,line,method:'join',fields:selected};joins.push(row);queryFiles.add(file);check(selected,row)}}
  }
 }ts.forEachChild(n,visit)}visit(sf);
}
const report={typescriptFilesParsed:parsed,apiAndHelperFilesReferencingSociety:queryFiles.size,files:[...queryFiles].sort(),directColumnOperations:direct.length,embeddedSocietyJoins:joins.length,invalidColumnReferences:invalid,directOperations:direct,joins};
fs.writeFileSync('artifacts/api-workbook-audit/society-table-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,directOperations:undefined,joins:undefined},null,2));
if(invalid.length)process.exitCode=1;
