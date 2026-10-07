// Spotify scripts: based on https://github.com/Amlabort/MY_clash (files/lpx/js). Strings translated to English, hosted by devchristian1337.
let body = $response.body;

function readVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (true) {
    const byte = buffer[pos];

    // take the low 7 bits
    const value = byte & 0x7F;

    // concatenate
    result |= value << shift;

    pos++;

    // if the high bit is 0 → stop
    if ((byte & 0x80) === 0) break;

    shift += 7;
  }

  return {
    value: result,      // parsed length
    length: pos - offset // bytes used by the varint
  };
}

function parseField6(buffer) {
  for (let i = 0; i < MAX; i++) {
    if (buffer[i] === 0x32) { // found field 6

      const { value, length } = readVarint(buffer, i + 1);

      console.log("Found field 6:");
      console.log(`Position: ${i}`);
      console.log(`Length: ${value}`);
      console.log(`varint bytes: ${length}`);

      if(value>12000) {

        buffer[i] = 0x7A;
        console.log("Changing tag value to remove ads");
        return {
        offset: i,
        dataLength: value,
        varintLength: length,
        totalLength: 1 + length + value
      };
      }  
    }
  }
  return null;
}

let MAX=666;
parseField6(body);
$done({body});
