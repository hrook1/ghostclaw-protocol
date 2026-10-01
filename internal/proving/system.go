package proving

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	kzgbn254 "github.com/consensys/gnark-crypto/ecc/bn254/kzg"
	"github.com/consensys/gnark/backend/plonk"
	plonkbn254 "github.com/consensys/gnark/backend/plonk/bn254"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/scs"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/circuit"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/ignition"
)

const (
	Identity = "identity"
	Deposit  = "deposit"
	Spend    = "spend"
	Withdraw = "withdraw"
)

type System struct {
	CCS constraint.ConstraintSystem
	PK  plonk.ProvingKey
	VK  plonk.VerifyingKey
}

type CircuitMetadata struct {
	Name              string `json:"name"`
	Constraints       int    `json:"constraints"`
	PublicInputs      int    `json:"publicInputs"`
	CanonicalSRSSize  int    `json:"canonicalSrsSize"`
	LagrangeSRSSize   int    `json:"lagrangeSrsSize"`
	SetupMilliseconds int64  `json:"setupMilliseconds"`
}

type Manifest struct {
	Backend   string                     `json:"backend"`
	Curve     string                     `json:"curve"`
	Gnark     string                     `json:"gnark"`
	Ignition  ignition.Metadata          `json:"ignition"`
	Circuits  map[string]CircuitMetadata `json:"circuits"`
	Generated string                     `json:"generatedAt"`
}

type SolidityProof struct {
	Proof        string   `json:"proof"`
	PublicInputs []string `json:"publicInputs"`
	ProveMS      float64  `json:"proveMs"`
	VerifyMS     float64  `json:"verifyMs"`
}

func Circuit(name string) (frontend.Circuit, error) {
	switch name {
	case Identity:
		return &circuit.IdentityV2{}, nil
	case Deposit:
		return &circuit.DepositV2{}, nil
	case Spend:
		return &circuit.SpendV2{}, nil
	case Withdraw:
		return &circuit.WithdrawV2{}, nil
	default:
		return nil, fmt.Errorf("unknown circuit %q", name)
	}
}

func Compile(name string) (constraint.ConstraintSystem, error) {
	definition, err := Circuit(name)
	if err != nil {
		return nil, err
	}
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder, definition)
	if err != nil {
		return nil, fmt.Errorf("compile %s: %w", name, err)
	}
	return ccs, nil
}

func SetupAll(artifactDir, verifierDir, ignitionPath string) (Manifest, error) {
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		return Manifest{}, fmt.Errorf("create artifact directory: %w", err)
	}
	if err := os.MkdirAll(verifierDir, 0o755); err != nil {
		return Manifest{}, fmt.Errorf("create verifier directory: %w", err)
	}

	names := []string{Identity, Deposit, Spend, Withdraw}
	compiled := make(map[string]constraint.ConstraintSystem, len(names))
	maxCanonical := 0
	for _, name := range names {
		ccs, err := Compile(name)
		if err != nil {
			return Manifest{}, err
		}
		compiled[name] = ccs
		canonical, _ := plonk.SRSSize(ccs)
		if canonical > maxCanonical {
			maxCanonical = canonical
		}
	}

	canonicalSRS, ignitionMeta, err := ignition.Load(ignitionPath, maxCanonical)
	if err != nil {
		return Manifest{}, err
	}
	// The verified transcript hash defines the SRS. A machine-specific path
	// would make an otherwise identical release manifest non-reproducible.
	ignitionMeta.Path = "public-parameters/bn254_g1.dat"
	manifest := Manifest{
		Backend:   "gnark PLONK KZG",
		Curve:     "BN254",
		Gnark:     "v0.15.0",
		Ignition:  ignitionMeta,
		Circuits:  make(map[string]CircuitMetadata, len(names)),
		Generated: time.Unix(0, 0).UTC().Format(time.RFC3339),
	}

	for _, name := range names {
		ccs := compiled[name]
		canonicalSize, lagrangeSize := plonk.SRSSize(ccs)
		canonical := &kzgbn254.SRS{
			Pk: kzgbn254.ProvingKey{G1: canonicalSRS.Pk.G1[:canonicalSize]},
			Vk: canonicalSRS.Vk,
		}
		lagrangeG1, err := kzgbn254.ToLagrangeG1(canonical.Pk.G1[:lagrangeSize])
		if err != nil {
			return Manifest{}, fmt.Errorf("convert %s SRS to Lagrange form: %w", name, err)
		}
		lagrange := &kzgbn254.SRS{
			Pk: kzgbn254.ProvingKey{G1: lagrangeG1},
			Vk: canonical.Vk,
		}

		pk, vk, err := plonk.Setup(ccs, canonical, lagrange)
		if err != nil {
			return Manifest{}, fmt.Errorf("setup %s: %w", name, err)
		}
		system := System{CCS: ccs, PK: pk, VK: vk}
		if err := system.Save(artifactDir, name); err != nil {
			return Manifest{}, err
		}
		if err := ExportVerifier(vk, filepath.Join(verifierDir, verifierName(name)+".sol"), verifierName(name)); err != nil {
			return Manifest{}, err
		}
		manifest.Circuits[name] = CircuitMetadata{
			Name:              name,
			Constraints:       ccs.GetNbConstraints(),
			PublicInputs:      ccs.GetNbPublicVariables(),
			CanonicalSRSSize:  canonicalSize,
			LagrangeSRSSize:   lagrangeSize,
			SetupMilliseconds: 0,
		}
	}

	if err := writeJSON(filepath.Join(artifactDir, "manifest.json"), manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func (s System) Save(dir, name string) error {
	files := []struct {
		suffix string
		value  io.WriterTo
	}{
		{".ccs", s.CCS},
		{".pk", s.PK},
		{".vk", s.VK},
	}
	for _, item := range files {
		path := filepath.Join(dir, name+item.suffix)
		file, err := os.Create(path)
		if err != nil {
			return fmt.Errorf("create %s: %w", path, err)
		}
		writer := bufio.NewWriterSize(file, 1<<20)
		_, writeErr := item.value.WriteTo(writer)
		flushErr := writer.Flush()
		closeErr := file.Close()
		if writeErr != nil {
			return fmt.Errorf("write %s: %w", path, writeErr)
		}
		if flushErr != nil {
			return fmt.Errorf("flush %s: %w", path, flushErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close %s: %w", path, closeErr)
		}
	}
	return nil
}

func Load(dir, name string) (System, error) {
	system := System{
		CCS: plonk.NewCS(ecc.BN254),
		PK:  plonk.NewProvingKey(ecc.BN254),
		VK:  plonk.NewVerifyingKey(ecc.BN254),
	}
	files := []struct {
		suffix string
		value  io.ReaderFrom
	}{
		{".ccs", system.CCS},
		{".pk", system.PK},
		{".vk", system.VK},
	}
	for _, item := range files {
		path := filepath.Join(dir, name+item.suffix)
		file, err := os.Open(path)
		if err != nil {
			return System{}, fmt.Errorf("open %s: %w", path, err)
		}
		reader := bufio.NewReaderSize(file, 1<<20)
		_, readErr := item.value.ReadFrom(reader)
		closeErr := file.Close()
		if readErr != nil {
			return System{}, fmt.Errorf("read %s: %w", path, readErr)
		}
		if closeErr != nil {
			return System{}, fmt.Errorf("close %s: %w", path, closeErr)
		}
	}
	return system, nil
}

func (s System) Prove(assignment frontend.Circuit) (SolidityProof, error) {
	fullWitness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return SolidityProof{}, fmt.Errorf("create full witness: %w", err)
	}
	publicWitness, err := fullWitness.Public()
	if err != nil {
		return SolidityProof{}, fmt.Errorf("create public witness: %w", err)
	}

	proveStart := time.Now()
	proof, err := plonk.Prove(s.CCS, s.PK, fullWitness)
	proveDuration := time.Since(proveStart)
	if err != nil {
		return SolidityProof{}, fmt.Errorf("prove: %w", err)
	}
	verifyStart := time.Now()
	if err := plonk.Verify(proof, s.VK, publicWitness); err != nil {
		return SolidityProof{}, fmt.Errorf("native proof verification: %w", err)
	}
	verifyDuration := time.Since(verifyStart)

	bnProof, ok := proof.(*plonkbn254.Proof)
	if !ok {
		return SolidityProof{}, fmt.Errorf("unexpected PLONK proof type %T", proof)
	}
	vector, ok := publicWitness.Vector().(fr.Vector)
	if !ok {
		return SolidityProof{}, fmt.Errorf("unexpected public witness vector %T", publicWitness.Vector())
	}
	inputs := make([]string, len(vector))
	for i := range vector {
		inputs[i] = vector[i].String()
	}
	return SolidityProof{
		Proof:        "0x" + hex.EncodeToString(bnProof.MarshalSolidity()),
		PublicInputs: inputs,
		ProveMS:      float64(proveDuration.Microseconds()) / 1000,
		VerifyMS:     float64(verifyDuration.Microseconds()) / 1000,
	}, nil
}

func ExportVerifier(vk plonk.VerifyingKey, path, contractName string) error {
	var builder strings.Builder
	if err := vk.ExportSolidity(&builder); err != nil {
		return fmt.Errorf("export %s: %w", contractName, err)
	}
	source := strings.Replace(builder.String(), "contract PlonkVerifier", "contract "+contractName, 1)
	if source == builder.String() {
		return fmt.Errorf("generated verifier contract marker not found")
	}
	if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func verifierName(name string) string {
	switch name {
	case Identity:
		return "GhostClawGnarkIdentityVerifierV2"
	case Deposit:
		return "GhostClawGnarkDepositVerifierV2"
	case Spend:
		return "GhostClawGnarkSpendVerifierV2"
	case Withdraw:
		return "GhostClawGnarkWithdrawVerifierV2"
	default:
		panic("unknown verifier")
	}
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
