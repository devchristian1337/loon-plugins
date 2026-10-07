let body = $response.body;

let MAX=666;
let flag=0;
console.log(`HomeNoAd`);
for (let i = 0; i < MAX; i++) {
    if (body[i] === 0xAA && body[i + 1] === 0x01) {

        body[i] = 0xF7;
        body[i + 1] = 0x07;
        console.log(`Changed tag value at offset ${i}`);
        flag=1;
        $done({ body });
        return;
    }
}

if(!flag) console.log(`No ads detected`);
$done({});
