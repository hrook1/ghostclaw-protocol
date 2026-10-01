package operation

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
)

func checkInputCommitment(text string, calculated *big.Int) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	provided, err := parseField(text, false)
	if err != nil || provided.Cmp(calculated) != 0 {
		return fmt.Errorf("input commitment does not match the private note")
	}
	return nil
}

func parseAddress(value string) (*big.Int, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(value), "0x")
	if trimmed == "" {
		return nil, fmt.Errorf("empty address")
	}
	out, ok := new(big.Int).SetString(trimmed, 16)
	if !ok || out.Sign() < 0 || out.BitLen() > 160 {
		return nil, fmt.Errorf("invalid EVM address")
	}
	return out, nil
}

func parseField(value string, allowZero bool) (*big.Int, error) {
	trimmed := strings.TrimSpace(value)
	base := 10
	if strings.HasPrefix(trimmed, "0x") {
		base = 16
		trimmed = strings.TrimPrefix(trimmed, "0x")
	}
	if trimmed == "" {
		return nil, fmt.Errorf("empty field value")
	}
	out, ok := new(big.Int).SetString(trimmed, base)
	if !ok || out.Sign() < 0 || (!allowZero && out.Sign() == 0) {
		return nil, fmt.Errorf("invalid field value")
	}
	if out.Cmp(fr.Modulus()) >= 0 {
		return nil, fmt.Errorf("field value exceeds the BN254 scalar field")
	}
	return out, nil
}

func parseUint64(value string, allowZero bool) (*big.Int, error) {
	out, err := parseField(value, allowZero)
	if err != nil {
		return nil, err
	}
	if out.BitLen() > 64 {
		return nil, fmt.Errorf("value exceeds 64 bits")
	}
	return out, nil
}
