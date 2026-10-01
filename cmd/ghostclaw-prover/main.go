package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/consensys/gnark/frontend"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/operation"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/proving"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/scenario"
)

type proofBundle struct {
	Protocol   string                    `json:"protocol"`
	Network    string                    `json:"network"`
	Context    string                    `json:"context"`
	Payer      string                    `json:"payer"`
	Merchant   string                    `json:"merchant"`
	Owners     map[string]string         `json:"owners"`
	Identities map[string]identityBundle `json:"identities"`
	Deposit    depositBundle             `json:"deposit"`
	Payment    paymentBundle             `json:"payment"`
	Withdraw   withdrawalBundle          `json:"withdraw"`
}

type identityBundle struct {
	Proof        proving.SolidityProof `json:"proof"`
	Owner        string                `json:"owner"`
	Account      string                `json:"account"`
	ActionDigest string                `json:"actionDigest"`
}

type depositBundle struct {
	Proof      proving.SolidityProof `json:"proof"`
	Commitment string                `json:"commitment"`
	Amount     string                `json:"amount"`
}

type paymentBundle struct {
	Proof               proving.SolidityProof `json:"proof"`
	SpendRoot           string                `json:"spendRoot"`
	Nullifier           string                `json:"nullifier"`
	OutputLeft          string                `json:"outputLeft"`
	OutputRight         string                `json:"outputRight"`
	RecipientCommitment string                `json:"recipientCommitment"`
	ChangeCommitment    string                `json:"changeCommitment"`
	RecipientOwner      string                `json:"recipientOwner"`
	PaymentIntent       string                `json:"paymentIntent"`
	Merchant            string                `json:"merchant"`
}

type withdrawalBundle struct {
	Proof            proving.SolidityProof `json:"proof"`
	SpendRoot        string                `json:"spendRoot"`
	Nullifier        string                `json:"nullifier"`
	ChangeCommitment string                `json:"changeCommitment"`
	Recipient        string                `json:"recipient"`
	Amount           string                `json:"amount"`
}

type ownerRequest struct {
	Context  string `json:"context"`
	SpendKey string `json:"spendKey"`
}

type ownerResult struct {
	Owner string `json:"owner"`
}

type dynamicDepositBundle struct {
	Proof      proving.SolidityProof `json:"proof"`
	Owner      string                `json:"owner"`
	Commitment string                `json:"commitment"`
	Amount     string                `json:"amount"`
	Note       operation.NoteV2      `json:"note"`
}

type dynamicIdentityBundle struct {
	Proof        proving.SolidityProof `json:"proof"`
	Owner        string                `json:"owner"`
	ActionDigest string                `json:"actionDigest"`
}

type dynamicPaymentBundle struct {
	Proof               proving.SolidityProof `json:"proof"`
	SpendRoot           string                `json:"spendRoot"`
	Nullifier           string                `json:"nullifier"`
	OutputLeft          string                `json:"outputLeft"`
	OutputRight         string                `json:"outputRight"`
	RecipientCommitment string                `json:"recipientCommitment"`
	ChangeCommitment    string                `json:"changeCommitment"`
	SenderOwner         string                `json:"senderOwner"`
	RecipientOwner      string                `json:"recipientOwner"`
	PaymentIntent       string                `json:"paymentIntent"`
	RecipientNote       operation.NoteV2      `json:"recipientNote"`
	ChangeNote          operation.NoteV2      `json:"changeNote"`
}

type dynamicWithdrawalBundle struct {
	Proof            proving.SolidityProof `json:"proof"`
	SpendRoot        string                `json:"spendRoot"`
	Nullifier        string                `json:"nullifier"`
	ChangeCommitment string                `json:"changeCommitment"`
	Owner            string                `json:"owner"`
	ActionDigest     string                `json:"actionDigest"`
	Amount           string                `json:"amount"`
	ChangeNote       *operation.NoteV2     `json:"changeNote"`
}

type benchmarkReport struct {
	Protocol   string                      `json:"protocol"`
	Platform   string                      `json:"platform"`
	GoVersion  string                      `json:"goVersion"`
	Iterations int                         `json:"iterations"`
	Circuits   map[string]circuitBenchmark `json:"circuits"`
	Generated  string                      `json:"generatedAt"`
}

type circuitBenchmark struct {
	ProofBytes int        `json:"proofBytes"`
	ProveMS    statistics `json:"proveMs"`
	VerifyMS   statistics `json:"verifyMs"`
}

type statistics struct {
	Min    float64 `json:"min"`
	Median float64 `json:"median"`
	P95    float64 `json:"p95"`
	Max    float64 `json:"max"`
	Mean   float64 `json:"mean"`
}

func main() {
	if len(os.Args) < 2 {
		fatalf("usage: ghostclaw-prover <setup|owner|tree-witness|inspect-received-payment|prove-identity|prove-deposit|prove-payment|prove-withdrawal|prove-scenario|benchmark>")
	}
	switch os.Args[1] {
	case "setup":
		runSetup(os.Args[2:])
	case "owner":
		runOwner(os.Args[2:])
	case "tree-witness":
		runTreeWitness(os.Args[2:])
	case "inspect-received-payment":
		runInspectReceivedPayment(os.Args[2:])
	case "prove-identity":
		runIdentity(os.Args[2:])
	case "prove-deposit":
		runDeposit(os.Args[2:])
	case "prove-payment":
		runPayment(os.Args[2:])
	case "prove-withdrawal":
		runWithdrawal(os.Args[2:])
	case "prove-scenario":
		runScenario(os.Args[2:])
	case "benchmark":
		runBenchmark(os.Args[2:])
	default:
		fatalf("unknown command %q", os.Args[1])
	}
}

func runInspectReceivedPayment(args []string) {
	flags := flag.NewFlagSet("inspect-received-payment", flag.ExitOnError)
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.ReceivedPaymentRequestV2
	must(readJSON(*input, &request))
	result, err := operation.InspectReceivedPaymentV2(request)
	must(err)
	must(writePrivateJSON(*output, result))
}

func runOwner(args []string) {
	flags := flag.NewFlagSet("owner", flag.ExitOnError)
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request ownerRequest
	must(readJSON(*input, &request))
	owner, err := operation.DeriveOwnerV2(request.Context, request.SpendKey)
	must(err)
	must(writePrivateJSON(*output, ownerResult{Owner: owner.String()}))
}

func runTreeWitness(args []string) {
	flags := flag.NewFlagSet("tree-witness", flag.ExitOnError)
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.TreeWitnessRequestV2
	must(readJSON(*input, &request))
	result, err := operation.BuildTreeWitnessV2(request)
	must(err)
	must(writePrivateJSON(*output, result))
}

func runIdentity(args []string) {
	flags := flag.NewFlagSet("prove-identity", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.IdentityRequestV2
	must(readJSON(*input, &request))
	result, err := operation.BuildIdentityV2(request)
	must(err)
	must(writePrivateJSON(*output, dynamicIdentityBundle{
		Proof:        prove(*artifacts, proving.Identity, result.Assignment),
		Owner:        result.Owner.String(),
		ActionDigest: result.ActionDigest.String(),
	}))
}

func runDeposit(args []string) {
	flags := flag.NewFlagSet("prove-deposit", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.DepositRequestV2
	must(readJSON(*input, &request))
	result, err := operation.BuildDepositV2(request)
	must(err)
	must(writePrivateJSON(*output, dynamicDepositBundle{
		Proof:      prove(*artifacts, proving.Deposit, result.Assignment),
		Owner:      result.Owner.String(),
		Commitment: result.Commitment.String(),
		Amount:     result.Note.Amount,
		Note:       result.Note,
	}))
}

func runPayment(args []string) {
	flags := flag.NewFlagSet("prove-payment", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.PaymentRequestV2
	must(readJSON(*input, &request))
	result, err := operation.BuildPaymentV2(request)
	must(err)
	must(writePrivateJSON(*output, dynamicPaymentBundle{
		Proof:               prove(*artifacts, proving.Spend, result.Assignment),
		SpendRoot:           request.Input.SpendRoot,
		Nullifier:           result.Nullifier.String(),
		OutputLeft:          result.OutputLeft.String(),
		OutputRight:         result.OutputRight.String(),
		RecipientCommitment: result.RecipientCommitment.String(),
		ChangeCommitment:    result.ChangeCommitment.String(),
		SenderOwner:         result.SenderOwner.String(),
		RecipientOwner:      request.RecipientOwner,
		PaymentIntent:       result.PaymentIntent.String(),
		RecipientNote:       result.RecipientNote,
		ChangeNote:          result.ChangeNote,
	}))
}

func runWithdrawal(args []string) {
	flags := flag.NewFlagSet("prove-withdrawal", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	input := flags.String("input", "-", "request JSON path or - for stdin")
	output := flags.String("out", "-", "result JSON path or - for stdout")
	must(flags.Parse(args))
	var request operation.WithdrawalRequestV2
	must(readJSON(*input, &request))
	result, err := operation.BuildWithdrawalV2(request)
	must(err)
	must(writePrivateJSON(*output, dynamicWithdrawalBundle{
		Proof:            prove(*artifacts, proving.Withdraw, result.Assignment),
		SpendRoot:        request.Input.SpendRoot,
		Nullifier:        result.Nullifier.String(),
		ChangeCommitment: result.ChangeCommitment.String(),
		Owner:            result.Owner.String(),
		ActionDigest:     result.ActionDigest.String(),
		Amount:           request.Amount,
		ChangeNote:       result.ChangeNote,
	}))
}

func runSetup(args []string) {
	flags := flag.NewFlagSet("setup", flag.ExitOnError)
	srs := flags.String("ignition-g1", defaultSRS(), "path to the pinned Aztec Ignition G1 transcript")
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	verifiers := flags.String("verifiers", "generated", "generated Solidity verifier directory")
	must(flags.Parse(args))

	manifest, err := proving.SetupAll(*artifacts, *verifiers, *srs)
	must(err)
	printJSON(manifest)
}

func runScenario(args []string) {
	flags := flag.NewFlagSet("prove-scenario", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	context := flags.String("context", "", "pool address")
	payer := flags.String("payer", "", "payer address")
	merchant := flags.String("merchant", "", "merchant address")
	requestDigest := flags.String("request-digest", "0x3001", "salted x402 request digest")
	payerSpendKey := flags.String("payer-spend-key", "0x1001", "payer spend key")
	merchantSpendKey := flags.String("merchant-spend-key", "0x1002", "merchant spend key")
	existingLeavesPath := flags.String("existing-leaves", "", "existing public leaf JSON path")
	out := flags.String("out", "generated/e2e-proofs.json", "proof bundle path")
	must(flags.Parse(args))
	var existingLeafStrings []string
	if *existingLeavesPath != "" {
		must(readJSON(*existingLeavesPath, &existingLeafStrings))
	}
	existingLeaves := make([]*big.Int, len(existingLeafStrings))
	for index, value := range existingLeafStrings {
		leaf, ok := new(big.Int).SetString(value, 0)
		if !ok {
			fatalf("existing leaf %d is invalid", index)
		}
		existingLeaves[index] = leaf
	}

	assignments, err := scenario.BuildV2WithState(
		*context,
		*payer,
		*merchant,
		*requestDigest,
		*payerSpendKey,
		*merchantSpendKey,
		existingLeaves,
	)
	must(err)
	payerIdentityProof := prove(*artifacts, proving.Identity, assignments.IdentityPayer)
	merchantIdentityProof := prove(*artifacts, proving.Identity, assignments.IdentityMerchant)
	depositProof := prove(*artifacts, proving.Deposit, assignments.Deposit)
	spendProof := prove(*artifacts, proving.Spend, assignments.Spend)
	withdrawProof := prove(*artifacts, proving.Withdraw, assignments.Withdraw)
	bundle := proofBundle{
		Protocol: "GhostClaw Confidential Payments v2",
		Network:  "Base Sepolia",
		Context:  assignments.Values.Context.String(),
		Payer:    *payer,
		Merchant: *merchant,
		Owners: map[string]string{
			"payer":    assignments.Values.PayerOwner.String(),
			"merchant": assignments.Values.MerchantOwner.String(),
		},
		Identities: map[string]identityBundle{
			"payer": {
				Proof:        payerIdentityProof,
				Owner:        assignments.Values.PayerOwner.String(),
				Account:      *payer,
				ActionDigest: assignments.IdentityPayer.ActionDigest.(*big.Int).String(),
			},
			"merchant": {
				Proof:        merchantIdentityProof,
				Owner:        assignments.Values.MerchantOwner.String(),
				Account:      *merchant,
				ActionDigest: assignments.IdentityMerchant.ActionDigest.(*big.Int).String(),
			},
		},
		Deposit: depositBundle{
			Proof:      depositProof,
			Commitment: assignments.Values.DepositCommitment.String(),
			Amount:     fmt.Sprint(scenario.DepositAmount),
		},
		Payment: paymentBundle{
			Proof:               spendProof,
			SpendRoot:           assignments.Values.DepositRoot.String(),
			Nullifier:           assignments.Values.SpendNullifier.String(),
			OutputLeft:          assignments.Values.OutputLeft.String(),
			OutputRight:         assignments.Values.OutputRight.String(),
			RecipientCommitment: assignments.Values.RecipientCommitment.String(),
			ChangeCommitment:    assignments.Values.ChangeCommitment.String(),
			RecipientOwner:      assignments.Values.MerchantOwner.String(),
			PaymentIntent:       assignments.Values.PaymentIntent.String(),
			Merchant:            *merchant,
		},
		Withdraw: withdrawalBundle{
			Proof:            withdrawProof,
			SpendRoot:        assignments.Values.PaymentRoot.String(),
			Nullifier:        assignments.Values.WithdrawalNullifier.String(),
			ChangeCommitment: assignments.Values.WithdrawalCommitment.String(),
			Recipient:        *payer,
			Amount:           fmt.Sprint(scenario.WithdrawalAmount),
		},
	}
	must(writeJSON(*out, bundle))
	printJSON(bundle)
}

func runBenchmark(args []string) {
	flags := flag.NewFlagSet("benchmark", flag.ExitOnError)
	artifacts := flags.String("artifacts", "artifacts", "setup artifact directory")
	context := flags.String("context", "0x1111111111111111111111111111111111111111", "pool address")
	payer := flags.String("payer", "0x2222222222222222222222222222222222222222", "payer address")
	merchant := flags.String("merchant", "0x3333333333333333333333333333333333333333", "merchant address")
	iterations := flags.Int("iterations", 5, "proof samples per circuit")
	out := flags.String("out", "benchmark-results/native-proving.json", "benchmark report path")
	must(flags.Parse(args))
	if *iterations < 1 {
		fatalf("iterations must be positive")
	}

	assignments, err := scenario.BuildV2(*context, *payer, *merchant, "0x3001")
	must(err)
	circuits := []struct {
		name       string
		assignment frontend.Circuit
	}{
		{proving.Identity, assignments.IdentityPayer},
		{proving.Deposit, assignments.Deposit},
		{proving.Spend, assignments.Spend},
		{proving.Withdraw, assignments.Withdraw},
	}
	report := benchmarkReport{
		Protocol:   "GhostClaw Confidential Payments v2",
		Platform:   runtime.GOOS + "/" + runtime.GOARCH,
		GoVersion:  runtime.Version(),
		Iterations: *iterations,
		Circuits:   make(map[string]circuitBenchmark, len(circuits)),
		Generated:  time.Now().UTC().Format(time.RFC3339),
	}
	for _, item := range circuits {
		system, err := proving.Load(*artifacts, item.name)
		must(err)
		proveSamples := make([]float64, *iterations)
		verifySamples := make([]float64, *iterations)
		proofBytes := 0
		for i := 0; i < *iterations; i++ {
			result, err := system.Prove(item.assignment)
			must(err)
			proveSamples[i] = result.ProveMS
			verifySamples[i] = result.VerifyMS
			proofBytes = (len(result.Proof) - 2) / 2
		}
		report.Circuits[item.name] = circuitBenchmark{
			ProofBytes: proofBytes,
			ProveMS:    summarize(proveSamples),
			VerifyMS:   summarize(verifySamples),
		}
	}
	must(writeJSON(*out, report))
	printJSON(report)
}

func prove(artifactDir, name string, assignment frontend.Circuit) proving.SolidityProof {
	system, err := proving.Load(artifactDir, name)
	must(err)
	result, err := system.Prove(assignment)
	must(err)
	return result
}

func summarize(samples []float64) statistics {
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	var total float64
	for _, sample := range sorted {
		total += sample
	}
	p95Index := int(math.Ceil(float64(len(sorted))*0.95)) - 1
	return statistics{
		Min:    sorted[0],
		Median: sorted[len(sorted)/2],
		P95:    sorted[p95Index],
		Max:    sorted[len(sorted)-1],
		Mean:   total / float64(len(sorted)),
	}
}

func defaultSRS() string {
	if value := os.Getenv("GHOSTCLAW_IGNITION_G1"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".bb-crs", "bn254_g1.dat")
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func readJSON(path string, value any) error {
	var reader io.Reader = os.Stdin
	if path != "-" {
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		reader = file
	}
	decoder := json.NewDecoder(io.LimitReader(reader, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func writePrivateJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if path == "-" {
		_, err = os.Stdout.Write(data)
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func printJSON(value any) {
	data, err := json.MarshalIndent(value, "", "  ")
	must(err)
	fmt.Println(string(data))
}

func must(err error) {
	if err != nil {
		fatalf("%v", err)
	}
}

func fatalf(format string, values ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", values...)
	os.Exit(1)
}
