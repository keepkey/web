import { Box, Button, HStack, Image, useColorModeValue, useToast, VStack } from '@chakra-ui/react'
import { formatJsonRpcResult } from '@json-rpc-tools/utils'
import type { ethereum } from '@keepkey/chain-adapters'
import { FeeDataKey } from '@keepkey/chain-adapters'
import { KnownChainIds } from '@keepkey/types'
import type { BIP32Path } from '@shapeshiftoss/hdwallet-core'
import type { KeepKeyHDWallet } from '@shapeshiftoss/hdwallet-keepkey'
import type { SignClientTypes } from '@walletconnect/types'
import axios from 'axios'
import { Card } from 'components/Card/Card'
import { KeepKeyIcon } from 'components/Icons/KeepKeyIcon'
import { Text } from 'components/Text'
import { getChainAdapterManager } from 'context/PluginProvider/chainAdapterSingleton'
import { useWallet } from 'hooks/useWallet/useWallet'
import { WalletConnectSignClient } from 'kkdesktop/walletconnect/utils'
import { bn, bnOrZero } from 'lib/bignumber/bignumber'
import { fromBaseUnit } from 'lib/math'
import { EIP155_SIGNING_METHODS } from 'plugins/walletConnectToDapps/data/EIP115Data'
import { rejectEIP155Request } from 'plugins/walletConnectToDapps/utils/utils'
import { useWalletConnect } from 'plugins/walletConnectToDapps/WalletConnectBridgeContext'
import { useCallback } from 'react'
import { useMemo } from 'react'
import { useEffect, useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { FaGasPump, FaWrench } from 'react-icons/fa'
import { useTranslate } from 'react-polyglot'
import Web3 from 'web3'

import { AddressSummaryCard } from './AddressSummaryCard'
import { ContractInteractionBreakdown } from './ContractInteractionBreakdown'
import { GasFeeEstimateLabel } from './GasFeeEstimateLabel'
import { GasInput } from './GasInput'
import { ModalSection } from './ModalSection'
import { TransactionAdvancedParameters } from './TransactionAdvancedParameters'

export type TxData = {
  nonce: string
  gasLimit: string
  gasPrice?: string
  maxPriorityFeePerGas: string
  maxFeePerGas: string
  data: string
  to: string
  value: string
}

export const EIP155SendTransactionConfirmation = () => {
  const translate = useTranslate()
  const cardBg = useColorModeValue('white', 'gray.850')
  const {
    state: { wallet },
  } = useWallet()

  const adapterManager = useMemo(() => getChainAdapterManager(), [])

  const [address, setAddress] = useState<string>()
  const [accountPath, setAccountPath] = useState<BIP32Path>()

  const form = useForm<any>({
    defaultValues: {
      nonce: '',
      gasLimit: '',
      maxPriorityFeePerGas: '',
      maxFeePerGas: '',
      currentFeeAmount: '',
    },
  })

  const [loading, setLoading] = useState(false)

  const { requests, removeRequest, isConnected, dapp, legacyWeb3 } = useWalletConnect()
  const toast = useToast()

  const currentRequest = requests[0] as SignClientTypes.EventArguments['session_request']
  const { topic, params, id } = currentRequest
  const { request, chainId: chainIdString } = params
  const [chainId, setChainId] = useState<number>()

  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    const accounts = (wallet as KeepKeyHDWallet).ethGetAccountPaths({
      coin: 'Ethereum',
      accountIdx: 0,
    })
    setAccountPath(accounts[0].addressNList)
    ;(wallet as KeepKeyHDWallet)
      .ethGetAddress({ addressNList: accounts[0].addressNList, showDisplay: false })
      .then(accAddress => {
        setLoading(false)
        setAddress(accAddress)
      })
  }, [wallet])

  useEffect(() => {
    if (!chainIdString) return
    const chainIdRegexp = chainIdString.match(/^eip155:([0-9]+)$/)
    if (!chainIdRegexp) return
    setChainId(Number(chainIdRegexp[1]))
  }, [chainIdString])

  const onConfirm = useCallback(
    async (txData: any) => {
      if (!wallet || !accountPath || !chainId || !legacyWeb3) return
      try {
        setLoading(true)
        const signData: any = {
          addressNList: accountPath,
          chainId,
          data: txData.data,
          gasLimit: txData.gasLimit,
          to: txData.to,
          value: txData.value ?? '0x0',
          nonce: txData.nonce,
          maxPriorityFeePerGas: txData.maxPriorityFeePerGas,
          maxFeePerGas: txData.maxFeePerGas,
        }

        // if gasPrice was passed in it means we couldnt get maxPriorityFeePerGas & maxFeePerGas
        if (request.params[0].gasPrice) {
          signData.gasPrice = request.params[0].gasPrice
          delete signData.maxPriorityFeePerGas
          delete signData.maxFeePerGas
        }

        const response = await (wallet as KeepKeyHDWallet).ethSignTx(signData)

        const signedTx = response?.serialized

        let jsonresponse = formatJsonRpcResult(id, signedTx)

        if (request.method === EIP155_SIGNING_METHODS.ETH_SEND_TRANSACTION) {
          await legacyWeb3.web3.eth.sendSignedTransaction(signedTx)
          const txid = legacyWeb3.web3.utils.sha3(signedTx)
          // @ts-ignore
          jsonresponse = formatJsonRpcResult(id, txid)
        }

        await WalletConnectSignClient.respond({
          topic,
          response: jsonresponse,
        })

        removeRequest(currentRequest.id)
      } catch (e) {
        console.error('HD WALLET ERROR', e)
        toast({
          title: 'Error',
          description: `Transaction error ${e}`,
          isClosable: true,
        })
      } finally {
        setLoading(false)
      }
    },
    [
      wallet,
      accountPath,
      chainId,
      legacyWeb3,
      request.params,
      request.method,
      id,
      topic,
      removeRequest,
      currentRequest.id,
      toast,
    ],
  )

  const onReject = useCallback(async () => {
    const response = rejectEIP155Request(currentRequest)
    WalletConnectSignClient.respond({
      topic: currentRequest.topic,
      response,
    })
    removeRequest(currentRequest.id)
    setLoading(false)
  }, [currentRequest, removeRequest])

  const [gasFeeData, setGasFeeData] = useState(undefined as any)
  const [priceData, setPriceData] = useState(bn(0))

  const [web3GasFeeData, setweb3GasFeeData] = useState('0')

  // determine which gasLimit to use: user input > from the request > or estimate
  const requestGas = parseInt(request.params[0].gasLimit ?? '0x0', 16).toString(10)
  const inputGas = useWatch({ control: form.control, name: 'gasLimit' })

  const [estimatedGas, setEstimatedGas] = useState('0')

  const txInputGas = Web3.utils.toHex(
    !!bnOrZero(inputGas).gt(0) ? inputGas : bnOrZero(requestGas).gt(0) ? requestGas : estimatedGas,
  )

  useEffect(() => {
    if (!chainId || !legacyWeb3) return
    const adapterManager = getChainAdapterManager()
    const adapter = adapterManager.get(
      KnownChainIds.EthereumMainnet,
    ) as unknown as ethereum.ChainAdapter
    adapter.getGasFeeData().then(feeData => {
      setGasFeeData(feeData)
      const fastData = feeData[FeeDataKey.Fast]
      const fastAmount = fromBaseUnit(
        bnOrZero(fastData?.maxFeePerGas).times(txInputGas),
        18,
      ).toString()
      form.setValue('currentFeeAmount', fastAmount)
    })

    // for non mainnet chains we use the simple web3.getGasPrice()
    legacyWeb3.web3.eth.getGasPrice().then((p: any) => setweb3GasFeeData(p))
  }, [form, txInputGas, chainId, legacyWeb3])

  useEffect(() => {
    ;(async () => {
      if (legacyWeb3?.coinGeckoId)
        try {
          const { data } = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${legacyWeb3.coinGeckoId}&vs_currencies=usd`,
          )
          setPriceData(bnOrZero(data?.[legacyWeb3.coinGeckoId]?.usd))
        } catch (e) {
          throw new Error('Failed to get price data')
        }
    })()
  }, [legacyWeb3])

  // determine which gas fees to use: user input > from the request > Fast
  const requestMaxPriorityFeePerGas = request.params[0].maxPriorityFeePerGas
  const requestMaxFeePerGas = request.params[0].maxFeePerGas

  const inputMaxPriorityFeePerGas = useWatch({
    control: form.control,
    name: 'maxPriorityFeePerGas',
  })

  const inputMaxFeePerGas = useWatch({
    control: form.control,
    name: 'maxFeePerGas',
  })

  const fastMaxPriorityFeePerGas = gasFeeData?.fast?.maxPriorityFeePerGas
  const fastMaxFeePerGas = gasFeeData?.fast?.maxFeePerGas

  const txMaxFeePerGas = Web3.utils.toHex(
    !!inputMaxFeePerGas
      ? inputMaxFeePerGas
      : !!requestMaxFeePerGas
      ? requestMaxFeePerGas
      : fastMaxFeePerGas,
  )

  const txMaxPriorityFeePerGas = Web3.utils.toHex(
    !!inputMaxPriorityFeePerGas
      ? inputMaxPriorityFeePerGas
      : !!requestMaxPriorityFeePerGas
      ? requestMaxPriorityFeePerGas
      : fastMaxPriorityFeePerGas,
  )

  // Recalculate estimated fee amount if txMaxFeePerGas changes
  useEffect(() => {
    const currentAmount = fromBaseUnit(bnOrZero(txMaxFeePerGas).times(txInputGas), 18)
    form.setValue('currentFeeAmount', currentAmount)
  }, [form, inputMaxFeePerGas, txInputGas, txMaxFeePerGas])

  // determine which nonce to use: user input > from the request > true nonce
  const requestNonce = request.params[0].nonce
  const inputNonce = useWatch({ control: form.control, name: 'nonce' })
  const [trueNonce, setTrueNonce] = useState('0')
  useEffect(() => {
    ;(async () => {
      const count = await legacyWeb3?.web3.eth.getTransactionCount(address ?? '')
      setTrueNonce(`${count}`)
    })()
  }, [adapterManager, address, legacyWeb3])
  const txInputNonce = Web3.utils.toHex(
    !!inputNonce ? inputNonce : !!requestNonce ? requestNonce : trueNonce,
  )

  useEffect(() => {
    try {
      legacyWeb3?.web3.eth
        .estimateGas({
          from: request.params[0].from,
          nonce: Number(txInputNonce),
          to: request.params[0].to,
          data: request.params[0].data,
        })
        .then((estimate: any) => {
          setEstimatedGas(estimate)
        })
    } catch (e) {
      // 500k seemed reasonable
      setEstimatedGas('500000')
    }
  }, [txInputNonce, address, currentRequest.params, legacyWeb3?.web3.eth, request.params])

  if (!isConnected || !dapp || !currentRequest) return null

  const txInput: TxData = {
    nonce: txInputNonce,
    gasLimit: txInputGas,
    data: request.params[0].data,
    to: request.params[0].to,
    value: request.params[0].value,
    maxFeePerGas: txMaxFeePerGas,
    maxPriorityFeePerGas: txMaxPriorityFeePerGas,
  }

  // not mainnet and they havent entered custom gas fee data and no fee data from wc request.
  // default to the web3 gasPrice for the network
  if (chainId !== 1 && !inputMaxPriorityFeePerGas && !requestMaxPriorityFeePerGas)
    txInput['gasPrice'] = Web3.utils.toHex(web3GasFeeData)

  return (
    <FormProvider {...form}>
      <VStack p={6} spacing={6} alignItems='stretch'>
        <Box>
          <Text
            fontWeight='medium'
            translation='plugins.walletConnectToDapps.modal.sendTransaction.sendingFrom'
            mb={4}
          />
          <AddressSummaryCard
            address={address ?? ''}
            name='My Wallet' // TODO: what string do we put here?
            icon={<KeepKeyIcon color='gray.500' w='full' h='full' />}
          />
        </Box>

        <Box>
          <Text
            fontWeight='medium'
            translation='plugins.walletConnectToDapps.modal.sendTransaction.interactingWith'
            mb={4}
          />
          <AddressSummaryCard
            address={request.params[0].to}
            icon={
              <Image
                borderRadius='full'
                w='full'
                h='full'
                src='https://assets.coincap.io/assets/icons/256/eth.png'
              />
            }
          />
        </Box>

        <Box>
          <Text
            fontWeight='medium'
            translation='plugins.walletConnectToDapps.modal.sendTransaction.contractInteraction.title'
            mb={4}
          />
          <Card bg={cardBg} borderRadius='md' px={4} py={2}>
            <ContractInteractionBreakdown request={request} />
          </Card>
        </Box>

        <ModalSection
          title={
            <HStack justify='space-between'>
              <Text translation='plugins.walletConnectToDapps.modal.sendTransaction.estGasCost' />
              {legacyWeb3?.symbol && (
                <GasFeeEstimateLabel symbol={legacyWeb3?.symbol} fiatRate={priceData} />
              )}
            </HStack>
          }
          icon={<FaGasPump />}
          defaultOpen={false}
        >
          <Box pt={2}>
            <GasInput
              gasLimit={txInputGas}
              recommendedGasPriceData={{
                maxPriorityFeePerGas: request.params[0].maxPriorityFeePerGas,
                maxFeePerGas: request.params[0].maxFeePerGas,
              }}
            />
          </Box>
        </ModalSection>

        <ModalSection
          title={translate(
            'plugins.walletConnectToDapps.modal.sendTransaction.advancedParameters.title',
          )}
          icon={<FaWrench />}
          defaultOpen={false}
        >
          <TransactionAdvancedParameters />
        </ModalSection>

        <Text
          fontWeight='medium'
          color='gray.500'
          translation='plugins.walletConnectToDapps.modal.sendTransaction.description'
        />

        <VStack spacing={4}>
          <Button
            size='lg'
            width='full'
            colorScheme='blue'
            type='submit'
            isLoading={loading}
            onClick={() => onConfirm(txInput)}
          >
            {translate('plugins.walletConnectToDapps.modal.signMessage.confirm')}
          </Button>
          <Button size='lg' width='full' onClick={onReject}>
            {translate('plugins.walletConnectToDapps.modal.signMessage.reject')}
          </Button>
        </VStack>
      </VStack>
    </FormProvider>
  )
}
