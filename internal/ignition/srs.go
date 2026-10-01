package ignition

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"github.com/consensys/gnark-crypto/ecc/bn254"
	"github.com/consensys/gnark-crypto/ecc/bn254/fp"
	"github.com/consensys/gnark-crypto/ecc/bn254/kzg"
)

const (
	// This is the 2^17-point Aztec Ignition G1 transcript downloaded by
	// Barretenberg. A different transcript is rejected before setup.
	ExpectedG1Bytes  = 8_388_608
	ExpectedG1SHA256 = "3718ffbed583d8a279ccb2545196d5618e3fd97512b65aa051d2ebd0f57fb999"
)

var ignitionTauG2 = [4]string{
	"260e01b251f6f1c7e7ff4e580791dee8ea51d87a358e038b4efe30fac09383c1",
	"0118c4d5b837bcc2bc89b5b398b5974e9f5944073b32078b7e231fec938883b0",
	"04fc6369f7110fe3d25156c1bb9a72859cf2a04641f99ba4ee413c80da6a5fe4",
	"22febda3c0c0632a56475b4214e5615e11e6dd3f96e6cea2854a87d4dacc5e55",
}

type Metadata struct {
	Path          string `json:"path"`
	SHA256        string `json:"sha256"`
	TranscriptG1  int    `json:"transcriptG1Points"`
	LoadedG1      int    `json:"loadedG1Points"`
	PairingChecks int    `json:"pairingChecks"`
}

// Load reads the public Ignition monomial G1 powers and constructs the current
// gnark-crypto KZG representation. It validates the pinned transcript, points,
// generator, G2 point, and deterministic adjacent-power pairing relations.
func Load(path string, points int) (*kzg.SRS, Metadata, error) {
	var meta Metadata
	if points < 4 {
		return nil, meta, fmt.Errorf("Ignition SRS requires at least four G1 points")
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, meta, fmt.Errorf("open Ignition G1 transcript: %w", err)
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return nil, meta, fmt.Errorf("stat Ignition G1 transcript: %w", err)
	}
	if stat.Size() != ExpectedG1Bytes {
		return nil, meta, fmt.Errorf("unexpected Ignition transcript size: got %d, want %d", stat.Size(), ExpectedG1Bytes)
	}
	if points*64 > ExpectedG1Bytes {
		return nil, meta, fmt.Errorf("Ignition transcript has fewer than %d requested points", points)
	}

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return nil, meta, fmt.Errorf("hash Ignition transcript: %w", err)
	}
	sum := hex.EncodeToString(hasher.Sum(nil))
	if sum != ExpectedG1SHA256 {
		return nil, meta, fmt.Errorf("Ignition transcript SHA-256 mismatch: got %s", sum)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, meta, fmt.Errorf("rewind Ignition transcript: %w", err)
	}

	out := &kzg.SRS{}
	out.Pk.G1 = make([]bn254.G1Affine, points)
	raw := make([]byte, 64)
	for i := range out.Pk.G1 {
		if _, err := io.ReadFull(f, raw); err != nil {
			return nil, meta, fmt.Errorf("read Ignition G1 point %d: %w", i, err)
		}
		if err := out.Pk.G1[i].X.SetBytesCanonical(raw[:32]); err != nil {
			return nil, meta, fmt.Errorf("decode Ignition G1[%d].x: %w", i, err)
		}
		if err := out.Pk.G1[i].Y.SetBytesCanonical(raw[32:]); err != nil {
			return nil, meta, fmt.Errorf("decode Ignition G1[%d].y: %w", i, err)
		}
		if !out.Pk.G1[i].IsOnCurve() {
			return nil, meta, fmt.Errorf("Ignition G1[%d] is not on BN254", i)
		}
	}
	if !bn254.IsInSubGroupBatchG1(out.Pk.G1) {
		return nil, meta, fmt.Errorf("Ignition G1 points fail the BN254 subgroup check")
	}

	_, _, generatorG1, generatorG2 := bn254.Generators()
	if !out.Pk.G1[0].Equal(&generatorG1) {
		return nil, meta, fmt.Errorf("Ignition G1[0] is not the BN254 generator")
	}
	out.Vk.G1 = out.Pk.G1[0]
	out.Vk.G2[0] = generatorG2
	if err := setG2(&out.Vk.G2[1], ignitionTauG2); err != nil {
		return nil, meta, fmt.Errorf("decode Ignition tau G2: %w", err)
	}
	if !out.Vk.G2[1].IsOnCurve() || !out.Vk.G2[1].IsInSubGroup() {
		return nil, meta, fmt.Errorf("Ignition tau G2 fails the BN254 curve or subgroup check")
	}

	checks := []int{0, 1, 2, points / 2, points - 2}
	for _, i := range checks {
		var neg bn254.G1Affine
		neg.Neg(&out.Pk.G1[i])
		ok, err := bn254.PairingCheck(
			[]bn254.G1Affine{out.Pk.G1[i+1], neg},
			[]bn254.G2Affine{out.Vk.G2[0], out.Vk.G2[1]},
		)
		if err != nil {
			return nil, meta, fmt.Errorf("Ignition adjacent-power pairing check %d: %w", i, err)
		}
		if !ok {
			return nil, meta, fmt.Errorf("Ignition adjacent-power pairing check %d failed", i)
		}
	}

	out.Vk.Lines[0] = bn254.PrecomputeLines(out.Vk.G2[0])
	out.Vk.Lines[1] = bn254.PrecomputeLines(out.Vk.G2[1])
	meta = Metadata{
		Path:          path,
		SHA256:        sum,
		TranscriptG1:  ExpectedG1Bytes / 64,
		LoadedG1:      points,
		PairingChecks: len(checks),
	}
	return out, meta, nil
}

func setG2(point *bn254.G2Affine, values [4]string) error {
	parts := []*fp.Element{&point.X.A1, &point.X.A0, &point.Y.A1, &point.Y.A0}
	for i := range parts {
		if _, err := parts[i].SetString("0x" + values[i]); err != nil {
			return fmt.Errorf("coordinate %d: %w", i, err)
		}
	}
	return nil
}
