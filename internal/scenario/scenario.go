package scenario

import (
	"fmt"
	"math/big"
	"strings"
)

const (
	DepositAmount    = 100_000_000
	PaymentAmount    = 25_000_000
	WithdrawalAmount = 10_000_000
)

func ParseHex(value string, bits int) (*big.Int, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(value), "0x")
	if trimmed == "" {
		return nil, fmt.Errorf("empty hexadecimal value")
	}
	out, ok := new(big.Int).SetString(trimmed, 16)
	if !ok {
		return nil, fmt.Errorf("invalid hexadecimal value %q", value)
	}
	if out.Sign() < 0 || out.BitLen() > bits {
		return nil, fmt.Errorf("value exceeds %d bits", bits)
	}
	return out, nil
}
