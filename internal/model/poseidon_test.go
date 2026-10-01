package model

import (
	"math/big"
	"testing"
)

func TestTreeCompressionIsOrderedAndFieldChecked(t *testing.T) {
	left := big.NewInt(1)
	right := big.NewInt(2)
	forward, err := Tree(left, right)
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := Tree(right, left)
	if err != nil {
		t.Fatal(err)
	}
	if forward.Cmp(reverse) == 0 {
		t.Fatal("ordered Poseidon2 inputs produced the same digest")
	}
	if _, err := Tree(new(big.Int).Set(ScalarFieldModulus), big.NewInt(0)); err == nil {
		t.Fatal("out-of-field Poseidon2 input was accepted")
	}
}

func TestTreeCompressionVectors(t *testing.T) {
	for _, vector := range []struct {
		left  *big.Int
		right *big.Int
	}{
		{big.NewInt(0), big.NewInt(0)},
		{big.NewInt(1), big.NewInt(2)},
		{new(big.Int).Sub(ScalarFieldModulus, big.NewInt(1)), big.NewInt(42)},
	} {
		value, err := Tree(vector.left, vector.right)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("poseidon2(%s,%s)=%s", vector.left, vector.right, value)
	}
}
