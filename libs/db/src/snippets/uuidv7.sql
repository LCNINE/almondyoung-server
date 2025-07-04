CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
DECLARE
  t bigint;
  rand_bytes bytea;
BEGIN
  -- milliseconds since Unix epoch
  t := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  rand_bytes := gen_random_bytes(10); -- 80 random bits

  /*
    Build UUIDv7 (draft‑RFC‑4122 v7)
    48 bits: timestamp ms
    12 bits: sub‑ms randomness
    4  bits: version (0111)
    62 bits: variant + randomness
  */
  RETURN (
    -- time_hi (32 bits)
    lpad(to_hex((t >> 16) & 0xffffffff), 8, '0') || '-'
    -- time_mid (16 bits)
    || lpad(to_hex(t & 0xffff), 4, '0') || '-'
    -- time_low + version (16 bits)
    || lpad(to_hex(0x7000 | ((get_byte(rand_bytes,0)::int) & 0x0fff)), 4, '0') || '-'
    -- variant 10xx + 14 random bits
    || lpad(to_hex(0x8000 | (get_byte(rand_bytes,1)::int & 0x3fff)), 4, '0') || '-'
    -- 48 random bits
    || encode(substring(rand_bytes from 3 for 6), 'hex')
  )::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;
