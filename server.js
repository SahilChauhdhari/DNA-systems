/**
 * DNA Barcoding & Data Storage System — Backend
 * Node.js + Express REST API
 * 
 * Run: npm install && node server.js
 * Server starts on http://localhost:3001
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve the frontend HTML on the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── DNA ENCODING LOGIC ───────────────────────────────────────────────────────

/**
 * Binary → DNA encoding table
 * Each 2-bit pair maps to one base:
 *   00 → A,  01 → T,  10 → G,  11 → C
 */
const BINARY_TO_DNA = { '00': 'A', '01': 'T', '10': 'G', '11': 'C' };
const DNA_TO_BINARY = { 'A': '00', 'T': '01', 'G': '10', 'C': '11' };

/** Convert a text string to a binary string */
function textToBinary(text) {
  return text.split('').map(char =>
    char.charCodeAt(0).toString(2).padStart(8, '0')
  ).join('');
}

/** Convert a binary string to DNA sequence */
function binaryToDNA(binary) {
  // Pad binary to even length
  const padded = binary.padEnd(Math.ceil(binary.length / 2) * 2, '0');
  let dna = '';
  for (let i = 0; i < padded.length; i += 2) {
    dna += BINARY_TO_DNA[padded.slice(i, i + 2)];
  }
  return dna;
}

/** Convert DNA sequence back to binary string */
function dnaToBinary(dna) {
  return dna.toUpperCase().split('').map(base => DNA_TO_BINARY[base] || '').join('');
}

/** Convert binary string back to text */
function binaryToText(binary) {
  let text = '';
  for (let i = 0; i < binary.length; i += 8) {
    const byte = binary.slice(i, i + 8);
    if (byte.length === 8) {
      const charCode = parseInt(byte, 2);
      if (charCode > 0) text += String.fromCharCode(charCode);
    }
  }
  return text;
}

/** Validate that a string is a valid DNA sequence */
function isValidDNA(seq) {
  return /^[ATGCatgc]+$/.test(seq);
}

/** Compute GC content percentage */
function gcContent(dna) {
  const upper = dna.toUpperCase();
  const gc = (upper.match(/[GC]/g) || []).length;
  return ((gc / upper.length) * 100).toFixed(1);
}

/** 
 * Hamming-distance based alignment for equal-length sequences.
 * For unequal lengths, use a sliding window approach.
 */
function compareSequences(seq1, seq2) {
  const s1 = seq1.toUpperCase();
  const s2 = seq2.toUpperCase();
  const len = Math.max(s1.length, s2.length);
  const minLen = Math.min(s1.length, s2.length);

  let matches = 0;
  const alignment = [];

  for (let i = 0; i < minLen; i++) {
    const match = s1[i] === s2[i];
    if (match) matches++;
    alignment.push({ pos: i, base1: s1[i], base2: s2[i] || '-', match });
  }

  // Pad remaining positions
  for (let i = minLen; i < len; i++) {
    alignment.push({
      pos: i,
      base1: s1[i] || '-',
      base2: s2[i] || '-',
      match: false
    });
  }

  const similarity = ((matches / len) * 100).toFixed(2);

  return {
    similarity: parseFloat(similarity),
    matches,
    mismatches: len - matches,
    alignment,
    length1: s1.length,
    length2: s2.length,
    hammingDistance: len - matches
  };
}

/**
 * Generate a DNA barcode hash from a sequence.
 * Returns both a hex ID and a binary barcode pattern.
 */
function generateBarcode(dna) {
  const upper = dna.toUpperCase();
  const hash = crypto.createHash('sha256').update(upper).digest('hex');
  const shortId = hash.slice(0, 16).toUpperCase();

  // Create barcode pattern (binary representation of first 64 bits of hash)
  const barcodePattern = hash.slice(0, 16)
    .split('')
    .map(c => parseInt(c, 16).toString(2).padStart(4, '0'))
    .join('');

  // Compute sequence stats for barcode metadata
  const baseCount = { A: 0, T: 0, G: 0, C: 0 };
  for (const base of upper) {
    if (baseCount[base] !== undefined) baseCount[base]++;
  }

  return {
    id: `DNA-${shortId}`,
    hash: hash,
    barcodePattern,
    sequenceLength: upper.length,
    gcContent: parseFloat(gcContent(upper)),
    baseComposition: baseCount,
    checksum: hash.slice(0, 8)
  };
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

/**
 * POST /encode
 * Body: { text: string }
 * Returns step-by-step encoding result
 */
app.post('/encode', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid input: text string required' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Input too long (max 5000 chars)' });
    }

    const binary = textToBinary(text);
    const dna = binaryToDNA(binary);

    // Segment into codons (3-base triplets for visual display)
    const codons = [];
    for (let i = 0; i < dna.length; i += 3) {
      codons.push(dna.slice(i, i + 3));
    }

    res.json({
      success: true,
      input: text,
      steps: {
        text,
        binary,
        dna,
        codons,
        binarySegmented: binary.match(/.{1,8}/g) || [binary],
        charMap: text.split('').map(c => ({
          char: c,
          ascii: c.charCodeAt(0),
          binary: c.charCodeAt(0).toString(2).padStart(8, '0'),
          dna: binaryToDNA(c.charCodeAt(0).toString(2).padStart(8, '0'))
        }))
      },
      stats: {
        inputLength: text.length,
        binaryLength: binary.length,
        dnaLength: dna.length,
        gcContent: parseFloat(gcContent(dna)),
        compressionRatio: (text.length / dna.length).toFixed(3)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /decode
 * Body: { dna: string }
 * Returns decoded text
 */
app.post('/decode', (req, res) => {
  try {
    const { dna } = req.body;
    if (!dna || typeof dna !== 'string') {
      return res.status(400).json({ error: 'Invalid input: DNA string required' });
    }
    if (!isValidDNA(dna)) {
      return res.status(400).json({ error: 'Invalid DNA sequence: only A, T, G, C allowed' });
    }

    const binary = dnaToBinary(dna);
    const text = binaryToText(binary);

    res.json({
      success: true,
      input: dna.toUpperCase(),
      steps: {
        dna: dna.toUpperCase(),
        binary,
        text
      },
      decoded: text,
      stats: {
        dnaLength: dna.length,
        binaryLength: binary.length,
        outputLength: text.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /barcode
 * Body: { dna: string }
 * Returns unique barcode for the sequence
 */
app.post('/barcode', (req, res) => {
  try {
    const { dna } = req.body;
    if (!dna || typeof dna !== 'string') {
      return res.status(400).json({ error: 'Invalid input: DNA string required' });
    }
    if (!isValidDNA(dna)) {
      return res.status(400).json({ error: 'Invalid DNA sequence: only A, T, G, C allowed' });
    }

    const barcode = generateBarcode(dna);
    res.json({ success: true, barcode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /compare
 * Body: { seq1: string, seq2: string }
 * Returns similarity analysis
 */
app.post('/compare', (req, res) => {
  try {
    const { seq1, seq2 } = req.body;
    if (!seq1 || !seq2) {
      return res.status(400).json({ error: 'Two DNA sequences required' });
    }
    if (!isValidDNA(seq1) || !isValidDNA(seq2)) {
      return res.status(400).json({ error: 'Invalid DNA: only A, T, G, C allowed' });
    }
    if (seq1.length > 2000 || seq2.length > 2000) {
      return res.status(400).json({ error: 'Sequences too long (max 2000 bases)' });
    }

    const result = compareSequences(seq1, seq2);
    res.json({
      success: true,
      comparison: result,
      seq1Stats: {
        length: seq1.length,
        gcContent: parseFloat(gcContent(seq1))
      },
      seq2Stats: {
        length: seq2.length,
        gcContent: parseFloat(gcContent(seq2))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'DNA System API' });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🧬 DNA System API running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  POST /encode   — text → DNA');
    console.log('  POST /decode   — DNA → text');
    console.log('  POST /barcode  — generate DNA barcode');
    console.log('  POST /compare  — compare two sequences\n');
  });
}

// Export the Express API for Vercel
module.exports = app;
