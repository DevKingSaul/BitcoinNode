const EventEmitter = require('events');
const crypto = require('crypto');

const MAGIC_BYTE = 0xD9B4BEF9;

class StreamError {
  constructor(code) {
      this.code = code
  }
}

const MAX_PAYLOAD_LENGTH = 2048;
const NO_PAYLOAD = Buffer.alloc(0);
  
const Errors = {
  UnsupportedNetwork: new StreamError('UNSUPPORTED_NETWORK'),
  PayloadExceedsLimit: new StreamError('PAYLOAD_EXCEEDS_LIMIT'),
  InvalidChecksum: new StreamError('INVALID_CHECKSUM')
}

function hashRaw(input) {
    return crypto.createHash('sha256').update(input).digest();
}

function doubleHash(input) {
    return hashRaw(hashRaw(input));
}

function BufferToString(buf) {
    const Index = buf.indexOf(0);
    if (Index == -1) return buf.toString();

    return buf.subarray(0, Index).toString();
}

function receivedBody(messageBody) {
    const checksum = doubleHash(messageBody).subarray(0, 4);
    if (!checksum.equals(this.header.subarray(20, 24))) throw Errors.InvalidChecksum;

    this.emit('message', {
        command: BufferToString(this.header.subarray(4, 16)),
        body: messageBody
    })
  
    this.newMessage();
}
  
function processStream(data) {
    if (this.destroyed) return
  
    let nextData = data
  
    for (;;) {
      if (this.headerPos === 24) {
        const bodyPtr = this.bodySize - this.bodyPos
        const body = nextData.subarray(0, bodyPtr)
        this.body.set(body, this.bodyPos)
        this.bodyPos += body.length
  
        if (this.bodyPos === this.bodySize) {
          const messageBody = Buffer.alloc(this.bodySize)
          this.body.copy(messageBody)
  
          this.receivedBody(messageBody)
  
          nextData = nextData.subarray(bodyPtr)
          if (nextData.length > 0) continue
        }
      } else {
        const headerPtr = 24 - this.headerPos
        const header = nextData.subarray(0, headerPtr)
        this.header.set(header, this.headerPos)
        this.headerPos += header.length
  
        if (this.headerPos === 24) {
            if (this.header.readUInt32LE() != MAGIC_BYTE) throw Errors.UnsupportedNetwork;

            const BodySize = this.header.readUInt32LE(16);
            if (BodySize > MAX_PAYLOAD_LENGTH) throw Errors.PayloadExceedsLimit;
            
            if (BodySize === 0) {
                this.receivedBody(NO_PAYLOAD)
            } else {
                this.bodySize = BodySize;
            }

            nextData = nextData.subarray(headerPtr)
            if (nextData.length > 0) continue
        }
      }
  
      break
    }
}

class BitcoinStream extends EventEmitter {
    constructor() {
        super();

        this.queue = [];
        this.busy = false;
        this.destroyed = false;

        this.header = Buffer.alloc(24);
        this.headerPos = 0;
        
        this.body = Buffer.alloc(MAX_PAYLOAD_LENGTH);
        this.bodySize = null;
        this.bodyPos = 0;
    }

    newMessage() {
        this.headerPos = 0;
        this.bodyPos = 0;
    }

    processLoop(packet) {
        this.busy = true

        let nextPacket = packet

        while (nextPacket) {
            try {
                this.processStream(nextPacket)

                nextPacket = this.queue.shift()
            } catch (e) {
                this.destroy(e)

                return
            }
        }

        this.busy = false
    }

    push(packet) {
        if (this.busy) {
          this.queue.push(packet)
        } else {
          this.processLoop(packet)
        }
    }

    destroy(e) {
        this.destroyed = true;
        this.busy = true;
        this.queue = [];

        this.emit('streamError', e);
    }
}

BitcoinStream.prototype.processStream = processStream;
BitcoinStream.prototype.receivedBody = receivedBody;

module.exports = {
    MAGIC_BYTE,
    BitcoinStream
}
