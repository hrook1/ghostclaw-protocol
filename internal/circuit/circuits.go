package circuit

import (
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"github.com/consensys/gnark/std/math/bits"
)

func range64(api frontend.API, value frontend.Variable) {
	bits.ToBinary(api, value, bits.WithNbDigits(64))
}

func hash(api frontend.API, domain int, values ...frontend.Variable) frontend.Variable {
	h, err := mimc.NewMiMC(api)
	if err != nil {
		panic(err)
	}
	h.Write(domain)
	h.Write(values...)
	return h.Sum()
}
