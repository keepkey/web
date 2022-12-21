import axios from 'axios'
import { getConfig } from 'config'
import { bnOrZero } from 'lib/bignumber/bignumber'
import { useEffect, useState } from 'react'

// Non-exhaustive typings. We do not want to keep this a 1/1 mapping to an external API
export type BoardroomGovernanceResult = {
  currentState: string
  title: string
  choices: string[]
  results: { total: number; choice: number }[]
  refId: string
}

export type ParsedBoardroomGovernanceResult = {
  refId: string
  title: string
  choices: string[]
  results: {
    absolute: string
    percent: string
  }[]
}

const BOARDROOM_API_BASE_URL = getConfig().REACT_APP_BOARDROOM_API_BASE_URL

export const parseGovernanceData = (
  governanceData: BoardroomGovernanceResult[],
): ParsedBoardroomGovernanceResult[] => {
  const activeProposals = governanceData.filter(data => data.currentState === 'active')
  const proposals = activeProposals.length ? activeProposals : [governanceData[0]]

  return proposals.map(({ title, choices, results, refId }) => {
    const totalResults = results.reduce((acc, currentResult) => {
      acc = acc.plus(currentResult.total)
      return acc
    }, bnOrZero('0'))

    return {
      refId,
      title,
      choices,
      results: choices.map((_, i) => ({
        absolute: bnOrZero(results[i]?.total).toString(),
        percent: results[i] ? bnOrZero(results[i].total).div(totalResults).toString() : '0',
      })),
    }
  })
}

export const useGetGovernanceData = () => {
  const [data, setData] = useState<ReturnType<typeof parseGovernanceData>>([])
  const [error, setError] = useState<any>()
  const [loaded, setLoaded] = useState<boolean>(false)

  useEffect(() => {
    const loadGovernanceData = async () => {
      try {
        const response = await axios.get<{ data: BoardroomGovernanceResult[] }>(
          `${BOARDROOM_API_BASE_URL}proposals`,
        )
        const governanceData = response?.data?.data
        const parsedGovernanceData = parseGovernanceData(governanceData)
        setData(parsedGovernanceData)
      } catch (e) {
        setError(e)
      } finally {
        setLoaded(true)
      }
    }

    loadGovernanceData()
  }, [])

  return { data, error, loaded }
}
